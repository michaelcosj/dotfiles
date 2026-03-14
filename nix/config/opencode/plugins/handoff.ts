import { type Plugin, tool } from "@opencode-ai/plugin";

export const BuildHandoff: Plugin = async ({ client }) => {
	return {
		tool: {
			opencode_build_handoff: tool({
				description:
					"For Opencode tui clients. Create a new session with the handoff prompt as an editable draft",
				args: {
					prompt: tool.schema.string().describe("The generated handoff prompt"),
					files: tool.schema
						.array(tool.schema.string())
						.optional()
						.describe(
							"Array of file paths to load into the new session's context",
						),
				},
				async execute(args) {
					const fileRefs = args.files?.length
						? args.files.map((f) => `@${f.replace(/^@/, "")}`).join(" ")
						: "";

					const useHandoffSkillPrompt =
						"---\n\nUse the `implement-plan` skill to implement this plan\n---";

					const fullPrompt = fileRefs
						? `${fileRefs}\n\n${useHandoffSkillPrompt}\n\n${args.prompt}`
						: `${useHandoffSkillPrompt}\n\n${args.prompt}`;

					await client.tui.executeCommand({ body: { command: "session_new" } });

					await new Promise((r) => setTimeout(r, 150));
					await client.tui.appendPrompt({ body: { text: fullPrompt } });

					await client.tui.showToast({
						body: {
							title: "Handoff Ready",
							message: "Review and edit the draft, then send",
							variant: "success",
							duration: 4000,
						},
					});

					return "Handoff prompt created in new session. Review and edit before sending.";
				},
			}),
		},
	};
};
