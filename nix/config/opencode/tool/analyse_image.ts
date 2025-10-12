import fs from "fs";
import { tool } from "@opencode-ai/plugin";

// Set your API key as an environment variable for security
const API_KEY = process.env.GEMINI_API_KEY;
const API_URL =
	"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

export default tool({
	description: "Analyse the contents of an image. Simply provide the full path to a local image file and the prompt for analysis.",
	args: {
		imagePath: tool.schema
			.string()
			.describe(
				"Full path to a local image file (e.g., /Users/username/Pictures/image.jpg)",
			),
		prompt: tool.schema
			.string()
			.describe(
				"Text prompt that would be the query used in analysing the image. (e.g Extract all text from this image and provide a detailed analysis of its contents.)",
			),
	},
	async execute(args: { imagePath: string; prompt: string }) {
		try {
			const response = await analyzeImage(args.imagePath, args.prompt);
			return `Tool executed successfully with result ${response}`;
		} catch (error) {
			return `An error occured ${error}`;
		}
	},
});

async function analyzeImage(imagePath: string, prompt: string) {
	try {
		// Read image file and convert to base64
		const imageBuffer = fs.readFileSync(imagePath);
		const base64Image = imageBuffer.toString("base64");

		// Determine MIME type based on file extension
		const extension = imagePath.split(".").pop()?.toLowerCase();
		let mimeType = "image/jpeg"; // default
		if (extension === "png") mimeType = "image/png";
		else if (extension === "webp") mimeType = "image/webp";

		// Prepare the request payload
		const requestBody = {
			contents: [
				{
					parts: [
						{ text: prompt },
						{
							inline_data: {
								mime_type: mimeType,
								data: base64Image,
							},
						},
					],
				},
			],
		};

		// Make the API request
		const response = await fetch(`${API_URL}?key=${API_KEY}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(requestBody),
		});

		if (!response.ok) {
			const errorData = await response.json();
			throw new Error(
				`API Error: ${response.status} - ${JSON.stringify(errorData)}`,
			);
		}

		const data = await response.json();

		// Extract the response text
		if (data.candidates && data.candidates[0] && data.candidates[0].content) {
			return data.candidates[0].content.parts[0].text;
		} else {
			throw new Error("Unexpected API response structure");
		}
	} catch (error) {
		console.error("Error:", error.message);
		throw error;
	}
}
