# DeepSeek coding harness

A completed command-line application for asking coding questions, reviewing or explaining an explicitly selected source file, and drafting JavaScript tests. It uses Node's built-in libraries and has no package dependencies. Repairs replace the original CLI's missing timeout, implicit environment-file loading, unbounded file reads, and accidental test-file overwrites.

## Run

Install Node 22 or later. Run `npm test` to execute the offline checks, or `node index.js --help` for usage. Set `DEEPSEEK_API_KEY` and `DEEPSEEK_MODEL` in your terminal environment for actual requests. Select a currently available model from the [official documentation](https://api-docs.deepseek.com/); no model name is assumed. The application does not load `.env` files.

```text
node index.js ask Explain binary search
node index.js review src/example.js
node index.js explain src/example.py
node index.js test src/example.js src/example.test.js
node index.js interactive
```

Run from the project directory you want to inspect. Interactive mode accepts questions, `/clear`, and `/exit`. Source content is sent only for an explicitly selected review, explanation, or test request. Each request also includes at most 200 source file names from the current directory and two subdirectory levels, plus the bounded conversation history. This is not an autonomous agent: it does not run commands, modify the reviewed source, or execute generated tests.

Optional settings: `DEEPSEEK_TEMPERATURE` (0–2, default 0.7), `DEEPSEEK_MAX_TOKENS` (1–8192, default 2048), and `DEEPSEEK_TIMEOUT_MS` (100–180000, default 60000). Model-specific limits can be stricter. Responses must finish normally; truncated, refused, malformed, and oversized responses fail without entering history. Errors omit provider bodies, headers and raw transport messages.

## File and credential handling

Source inputs are limited to 64 KB of valid UTF-8 with approved code extensions, inside the current project root. Hidden paths, common dependency folders, symbolic links and credential-like file names are blocked. Common literal secrets and the configured key are rejected in submitted/returned text. These checks are conservative and do not detect every possible secret; inspect the content you explicitly submit. Review/test requests are paid network requests and may disclose selected source to DeepSeek.

Test generation supports JavaScript only. The response must be one code block, pass Node's syntax checker, and target a new `.test.js`, `.test.cjs`, or `.test.mjs` file. Files are written exclusively, with no overwrite. Generated code is never executed by the harness; inspect it before running. Syntax validity does not establish meaningful or safe tests.

## Verification scope

The included offline tests example all noninteractive commands, payload construction, environment validation, bounded history, malformed/refused/truncated responses, timeout, concurrent requests, credential redaction, file traversal and link rejection, size limits, and safe generation without code execution. Provider calls are mocked; no API credential, paid request, or live model output was used for verification. Manual interactive terminal behavior and live provider compatibility remain unverified.

Protocol reference: [DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/).
