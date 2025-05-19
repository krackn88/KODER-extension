# KODER

An advanced VSCode pair programming extension that can hold your entire codebase in memory, providing intelligent assistance regardless of project size.

## Features

- **Native VSCode Integration**: Seamlessly works within your editor
- **Unlimited Codebase Memory**: Supports large codebases (works with 4TB SSD)
- **Local LLM Support**: Use local LLMs like Ollama and llama.cpp instead of cloud services
- **Semantic Code Search**: Find similar code across your codebase with vector embeddings
- **Terminal Integration**: Execute commands and get AI assistance with terminal output
- **File Editing**: Create/edit files with visual diff before applying changes
- **Task History**: Track your conversations and easily return to past tasks

## Terminal Integration

KODER can now interact with your terminal:

1. **Execute Commands**: Use `KODER: Execute Terminal Command` from the command palette to run terminal commands with AI assistance
2. **Add Terminal Output to Chat**: Right-click in any terminal and select `Add Terminal Output to Chat` to get AI analysis of terminal output
3. **Automatic Error Analysis**: When errors appear in your terminal, get instant assistance understanding and fixing them

## Semantic Code Search

KODER includes powerful semantic code search capabilities:

1. **Find Similar Code**: Select code and use `KODER: Find Similar Code` to locate similar implementations
2. **Automatic Embedding**: Files are automatically indexed for semantic search when saved
3. **Workspace Embedding**: Index your entire workspace with `KODER: Embed Workspace for Semantic Search`
4. **Configurable Vector Database**: Use in-memory, SQLite, or Qdrant vector databases

## Local LLM Integration

KODER now supports local LLMs, reducing reliance on cloud services:

1. **Ollama Support**: Connect to locally running Ollama instances
2. **llama.cpp Support**: Connect to llama.cpp server for low-level control
3. **Fallback Mechanism**: Use cloud services as fallback if local models aren't available
4. **Custom System Prompts**: Configure the assistant personality for different coding styles

## How to Use

1. Open VSCode in your project folder
2. Start KODER using the `KODER: Start Pair Programming` command
3. Ask questions about your code using the `KODER: Ask a Question` command
4. Index your workspace with `KODER: Index Workspace` for better context awareness
5. Use the terminal integration for command execution and output analysis
6. Configure your preferred LLM in the KODER sidebar

## Requirements

- VSCode 1.85.0 or higher
- For cloud features (optional):
  - Azure OpenAI service
  - Azure Blob Storage
  - Azure Cosmos DB
  - Azure Cognitive Search
- For local features (optional):
  - Ollama or llama.cpp server

## Setup

1. Clone this repository
2. Install dependencies: `npm install`
3. Configure settings in `.env` file (see `.env.example`)
4. Build the extension: `npm run build`
5. Install the extension in VSCode

## Development

- `npm run dev` - Start development server
- `npm run test` - Run tests
- `npm run package` - Package extension for distribution

## License

MIT
