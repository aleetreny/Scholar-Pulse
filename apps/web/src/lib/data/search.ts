"use client";

// Every ordering searches the same OpenAlex corpus. An upstream failure must
// remain an error: replacing it with recent feed snapshots changes the question
// and can turn a globally "most cited" search into papers with one citation.
export { searchPapers } from "./openalex.ts";
