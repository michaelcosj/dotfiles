import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type Plugin, tool } from "@opencode-ai/plugin";

// ═══════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════

const FIRMWARE_BASE_URL = "https://app.firmware.ai/api/v1";
const FIRMWARE_PROVIDER_ID = "firmware";
const QUOTA_WINDOW_MS = 5 * 60 * 60 * 1000; // 5 hours
const FETCH_TIMEOUT_MS = 10_000; // 10 seconds

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

interface AuthConfig {
	[key: string]: {
		type: "api" | "oauth";
		key?: string;
	};
}

interface QuotaResponse {
	used: number;
	reset: string | null;
}

interface CreateDeepResearchResponse {
	id: string;
	status: "queued";
}

interface GetDeepResearchResponse {
	id: string;
	status: "queued" | "running" | "succeeded" | "failed";
	title: string;
	topic: string;
	report: string;
	error?: string;
}

interface ListDeepResearchResponse {
	docs: Array<{
		id: string;
		status: "queued" | "running" | "succeeded" | "failed";
		title: string;
		topic: string;
		createdAt: string;
		updatedAt: string;
	}>;
	totalDocs: number;
}

type WhereClause = Record<string, unknown>;

interface ListDeepResearchFilters {
	limit?: number;
	sort?: string;
	where?: WhereClause;
}

// ═══════════════════════════════════════════════════════════════
// Result helpers
// ═══════════════════════════════════════════════════════════════

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function ok<T>(value: T): Result<T> {
	return { ok: true, value };
}

function err<T>(error: string): Result<T> {
	return { ok: false, error };
}

// ═══════════════════════════════════════════════════════════════
// File helpers
// ═══════════════════════════════════════════════════════════════

async function writeOutputFile(
	filePath: string,
	content: string,
): Promise<Result<void>> {
	try {
		await fs.promises.writeFile(filePath, content, "utf8");
		return ok(undefined);
	} catch (e: unknown) {
		const code = (e as NodeJS.ErrnoException).code;
		if (code === "ENOENT") {
			return err(`Directory does not exist: ${path.dirname(filePath)}`);
		}
		if (code === "EACCES") {
			return err(`Permission denied: ${filePath}`);
		}
		throw e;
	}
}

// ═══════════════════════════════════════════════════════════════
// Auth
// ═══════════════════════════════════════════════════════════════

function getLocalDir(): string {
	return path.join(os.homedir(), ".local", "share", "opencode");
}

async function readAuthConfigFile(): Promise<Result<AuthConfig>> {
	const filePath = path.join(getLocalDir(), "auth.json");

	try {
		const content = await fs.promises.readFile(filePath, "utf8");
		return ok(JSON.parse(content) as AuthConfig);
	} catch (e: unknown) {
		const code = (e as NodeJS.ErrnoException).code;
		if (code === "ENOENT") {
			return err(`Auth config not found: ${filePath}`);
		}
		if (code === "EACCES") {
			return err(`Permission denied: ${filePath}`);
		}
		if (e instanceof SyntaxError) {
			return err("Invalid JSON in auth config");
		}
		throw e;
	}
}

async function getFirmwareAPIKey(): Promise<Result<string>> {
	const configResult = await readAuthConfigFile();
	if (!configResult.ok) return configResult;

	const key = configResult.value[FIRMWARE_PROVIDER_ID]?.key;
	return key ? ok(key) : err("Firmware API key not found in auth config");
}

// ═══════════════════════════════════════════════════════════════
// Session frontmatter helpers
// ═══════════════════════════════════════════════════════════════

const SESSION_FRONTMATTER_REGEX = /^---\r?\nSESSION:[^\r\n]*\r?\n---\r?\n?/;

function tagTopicWithSession(sessionID: string, topic: string): string {
	return `---\nSESSION:${sessionID}\n---\n${topic}`;
}

function stripSessionFrontmatter(topic: string): string {
	return topic.replace(SESSION_FRONTMATTER_REGEX, "");
}

// ═══════════════════════════════════════════════════════════════
// Firmware API client
// ═══════════════════════════════════════════════════════════════

async function firmwareRequest<T>(
	path: string,
	options?: { method?: string; body?: unknown },
): Promise<Result<T>> {
	const apiKeyResult = await getFirmwareAPIKey();
	if (!apiKeyResult.ok) return apiKeyResult;

	const headers: Record<string, string> = {
		Authorization: `Bearer ${apiKeyResult.value}`,
	};

	if (options?.body) {
		headers["Content-Type"] = "application/json";
	}

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

	try {
		const response = await fetch(`${FIRMWARE_BASE_URL}${path}`, {
			method: options?.method ?? "GET",
			headers,
			body: options?.body ? JSON.stringify(options.body) : undefined,
			signal: controller.signal,
		});

		if (!response.ok) {
			const errorBody = await response.text();
			return err(
				`Error: ${response.status} ${response.statusText} ${errorBody}`,
			);
		}

		return ok((await response.json()) as T);
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			return err("Request timed out");
		}
		throw error;
	} finally {
		clearTimeout(timeoutId);
	}
}

async function startDeepResearch(
	sessionID: string,
	topic: string,
): Promise<Result<CreateDeepResearchResponse>> {
	return firmwareRequest<CreateDeepResearchResponse>("/research", {
		method: "POST",
		body: { topic: tagTopicWithSession(sessionID, topic) },
	});
}

async function getDeepResearch(
	researchId: string,
): Promise<Result<GetDeepResearchResponse>> {
	const result = await firmwareRequest<GetDeepResearchResponse>(
		`/research/${researchId}`,
	);

	if (!result.ok && result.error.includes("404")) {
		return err("Research job not found");
	}

	return result;
}

async function listDeepResearch(
	filters?: ListDeepResearchFilters,
): Promise<Result<ListDeepResearchResponse>> {
	const params = new URLSearchParams();

	if (filters?.where) {
		params.append("where", JSON.stringify(filters.where));
	}

	if (filters?.limit) {
		params.append("limit", filters.limit.toString());
	}

	if (filters?.sort) {
		params.append("sort", filters.sort);
	}

	return firmwareRequest<ListDeepResearchResponse>(
		`/research?${params.toString()}`,
	);
}

// ═══════════════════════════════════════════════════════════════
// Query/filter helpers
// ═══════════════════════════════════════════════════════════════

function buildListWhereClause(options: {
	sessionID?: string;
	currentSessionOnly: boolean;
	userWhere?: WhereClause;
}): WhereClause | undefined {
	const { sessionID, currentSessionOnly, userWhere } = options;
	const clauses: WhereClause[] = [];

	if (currentSessionOnly && sessionID) {
		clauses.push({
			"metadata.research.topic": {
				contains: `SESSION:${sessionID}`,
			},
		});
	}

	if (userWhere) {
		clauses.push(userWhere);
	}

	if (clauses.length === 0) return undefined;
	if (clauses.length === 1) return clauses[0];
	return { and: clauses };
}

// ═══════════════════════════════════════════════════════════════
// Quota formatting
// ═══════════════════════════════════════════════════════════════

export function formatQuotaAscii({ used, reset }: QuotaResponse) {
	const width = 26;
	const timeZone = "UTC";
	const title = "Quota Window";
	const now = new Date();
	const filledChar = "█";
	const emptyChar = "░";

	const usedClamped = clamp(Number(used), 0, 1);
	const usedPct = Number.isFinite(usedClamped)
		? Math.round(usedClamped * 100)
		: null;

	const usedBar = progressBar(usedClamped, width, filledChar, emptyChar);

	let timeBarLine = "";

	if (reset == null) {
		timeBarLine = `Remaining [${emptyChar.repeat(width)}] — (No active window)`;
	} else {
		const resetDate = new Date(reset);
		if (Number.isNaN(resetDate.getTime())) {
			timeBarLine = `Remaining [${emptyChar.repeat(width)}] — (Invalid reset time)`;
		} else {
			const resetStr = new Intl.DateTimeFormat(undefined, {
				year: "numeric",
				month: "short",
				day: "numeric",
				hour: "numeric",
				minute: "numeric",
				timeZone,
				timeZoneName: "short",
			}).format(resetDate);
			const diffMs = resetDate.getTime() - now.getTime();
			const left = diffMs <= 0 ? "now" : formatDurationShort(diffMs);

			const timeRemainingRatio =
				diffMs <= 0 ? 0 : Math.min(1, diffMs / QUOTA_WINDOW_MS);
			const timeBar = progressBar(
				timeRemainingRatio,
				width,
				filledChar,
				emptyChar,
			);

			timeBarLine = `Remaining [${timeBar}] ${left} (Resets at ${resetStr})`;
		}
	}

	const usedLine =
		usedPct == null
			? `Used      [${usedBar}] —`
			: `Used      [${usedBar}] ${String(usedPct).padStart(3, " ")}%`;

	const divider = "─".repeat(Math.max(title.length, 46));
	return [title, divider, usedLine, timeBarLine].join("\n");
}

function progressBar(
	value01: number,
	width: number,
	filledChar: string,
	emptyChar: string,
) {
	const filled = Math.round(clamp(value01, 0, 1) * width);
	return filledChar.repeat(filled) + emptyChar.repeat(width - filled);
}

function formatDurationShort(ms: number) {
	const totalMinutes = Math.max(0, Math.round(ms / 60000));
	const days = Math.floor(totalMinutes / (60 * 24));
	const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
	const minutes = totalMinutes % 60;
	const parts = [];

	if (days) parts.push(`${days}d`);
	if (hours || days) parts.push(`${hours}h`);

	parts.push(`${minutes}m`);
	return parts.join(" ");
}

function clamp(n: number, min: number, max: number) {
	return Math.min(max, Math.max(min, n));
}

// ═══════════════════════════════════════════════════════════════
// Plugin export
// ═══════════════════════════════════════════════════════════════

export const FirmwareDeepResearchPlugin: Plugin = async ({ client }) => {
	return {
		tool: {
			firmware_start_deep_research: tool({
				description: "Start a deep research job on a topic",
				args: {
					topic: tool.schema
						.string()
						.describe(
							"The research topic or question to investigate. Be specific for better results.",
						),
				},
				async execute({ topic }, context) {
					const result = await startDeepResearch(context.sessionID, topic);

					if (!result.ok) {
						return result.error;
					}

					return `Deep research created with id ${result.value.id}`;
				},
			}),
			firmware_get_deep_research: tool({
				description:
					"Get the status and report of a deep research job by ID. Poll this to check if research is complete.",
				args: {
					id: tool.schema.string().describe("The research job ID to retrieve"),
					outputFilePath: tool.schema
						.string()
						.describe(
							"The absolute path to the file to save the research content to if it is completed",
						),
				},
				async execute({ id, outputFilePath }) {
					const result = await getDeepResearch(id);
					if (!result.ok) {
						return `Error getting deep research ${id}: ${result.error}`;
					}

					const response = result.value;
					const cleanTopic = stripSessionFrontmatter(response.topic);

					if (response.status === "succeeded") {
						const writeResult = await writeOutputFile(
							outputFilePath,
							response.report,
						);
						if (!writeResult.ok) {
							return writeResult.error;
						}

						return [
							`Status: ${response.status}`,
							`Title: ${response.title}`,
							`Topic: ${cleanTopic}`,
							`Report saved to: ${outputFilePath}`,
							`Report length: ${response.report.length} characters`,
						].join("\n");
					}

					if (response.status === "failed") {
						return [
							`Status: ${response.status}`,
							`Title: ${response.title}`,
							`Topic: ${cleanTopic}`,
							`Error: ${response.error || "Unknown error"}`,
						].join("\n");
					}

					return [
						`Status: ${response.status}`,
						`Title: ${response.title}`,
						`Topic: ${cleanTopic}`,
						"Research is still in progress. Poll again in a few seconds.",
					].join("\n");
				},
			}),
			firmware_list_deep_research: tool({
				description:
					"List all deep research jobs with filtering and sorting. Use Payload query syntax for advanced filtering.",
				args: {
					currentSessionOnly: tool.schema
						.boolean()
						.default(true)
						.describe(
							"Filter by research that were started in the current session",
						),
					limit: tool.schema
						.number()
						.optional()
						.describe("Maximum number of results to return"),
					sort: tool.schema
						.string()
						.optional()
						.describe(
							"Field to sort by. Prefix with '-' for descending order. Examples: '-createdAt', 'title', '-updatedAt'",
						),
					where: tool.schema
						.string()
						.optional()
						.describe(
							"JSON-encoded filter query using Payload's query syntax. Available fields: 'id' (string), 'metadata.research.status' (queued|running|succeeded|failed), 'metadata.research.title' (string), 'metadata.research.topic' (string), 'createdAt' (ISO date string), 'updatedAt' (ISO date string). Operators: equals, not_equals, contains, exists, greater_than, less_than, in, not_in. Use 'and'/'or' for complex queries. Example: {\"metadata.research.status\":{\"equals\":\"succeeded\"},\"createdAt\":{\"greater_than\":\"2026-01-01T00:00:00.000Z\"}}",
						),
				},
				async execute({ limit, sort, where, currentSessionOnly }, context) {
					let userWhere: WhereClause | undefined;
					if (where) {
						try {
							const parsed = JSON.parse(where);
							if (
								typeof parsed !== "object" ||
								parsed === null ||
								Array.isArray(parsed)
							) {
								return "Error: where filter must be a JSON object";
							}
							userWhere = parsed as WhereClause;
						} catch {
							return "Error: Invalid JSON in where filter";
						}
					}

					const whereClause = buildListWhereClause({
						sessionID: context.sessionID,
						currentSessionOnly,
						userWhere,
					});

					const result = await listDeepResearch({
						limit,
						sort,
						where: whereClause,
					});

					if (!result.ok) {
						return result.error;
					}

					const { docs, totalDocs } = result.value;

					if (docs.length === 0) {
						return "No research jobs found matching the filters.";
					}

					const formatJob = (doc: (typeof docs)[0]) =>
						[
							`ID: ${doc.id}`,
							`Status: ${doc.status}`,
							`Title: ${doc.title}`,
							`Topic: ${stripSessionFrontmatter(doc.topic)}`,
							`Created: ${doc.createdAt}`,
							`Updated: ${doc.updatedAt}`,
						].join("\n");

					const jobsList = docs.map(formatJob).join("\n\n---\n\n");

					return `Found ${docs.length} of ${totalDocs} total research jobs:\n\n${jobsList}`;
				},
			}),
		},
		"command.execute.before": async ({ command, sessionID }) => {
			if (command === "firmware_quota") {
				const result = await firmwareRequest<QuotaResponse>("/quota");

				if (!result.ok) {
					throw new Error(result.error);
				}

				client.session.prompt({
					path: { id: sessionID },
					body: {
						noReply: true,
						parts: [
							{
								type: "text",
								text: formatQuotaAscii(result.value),
								ignored: true,
							},
						],
					},
				});

				throw new Error("QUOTA_COMMAND_HANDLED");
			}
		},
	};
};
