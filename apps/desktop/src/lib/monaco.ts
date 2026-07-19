import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

/**
 * Monaco, bundled locally.
 *
 * @monaco-editor/react fetches the editor from a CDN by default. That would
 * break the app offline and send a request out of the machine on first use,
 * which contradicts the whole local-first premise — so the bundled copy is
 * registered explicitly instead.
 */
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    switch (label) {
      case "json":
        return new jsonWorker();
      case "css":
      case "scss":
      case "less":
        return new cssWorker();
      case "html":
      case "handlebars":
      case "razor":
        return new htmlWorker();
      case "typescript":
      case "javascript":
        return new tsWorker();
      default:
        return new editorWorker();
    }
  },
};

loader.config({ monaco });

/** Editor theme matched to the rest of the app rather than Monaco's default. */
monaco.editor.defineTheme("aiw-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "6b7280", fontStyle: "italic" },
    { token: "keyword", foreground: "c084fc" },
    { token: "string", foreground: "86efac" },
    { token: "number", foreground: "fdba74" },
    { token: "type", foreground: "7dd3fc" },
    { token: "function", foreground: "67e8f9" },
    { token: "variable", foreground: "e5e5e7" },
  ],
  colors: {
    "editor.background": "#0a0a0b",
    "editor.foreground": "#e5e5e7",
    "editorLineNumber.foreground": "#3f3f46",
    "editorLineNumber.activeForeground": "#a1a1aa",
    "editor.selectionBackground": "#33333a",
    "editor.lineHighlightBackground": "#141417",
    "editorCursor.foreground": "#e5e5e7",
    "editorIndentGuide.background1": "#1f1f23",
    "editorGutter.background": "#0a0a0b",
    "diffEditor.insertedTextBackground": "#16a34a22",
    "diffEditor.removedTextBackground": "#dc262622",
  },
});

/** Map a filename to a Monaco language id. */
export function languageFor(path: string): string {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  const map: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".json": "json",
    ".css": "css",
    ".scss": "scss",
    ".html": "html",
    ".md": "markdown",
    ".markdown": "markdown",
    ".py": "python",
    ".rb": "ruby",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".c": "c",
    ".h": "c",
    ".cpp": "cpp",
    ".sh": "shell",
    ".bash": "shell",
    ".zsh": "shell",
    ".yml": "yaml",
    ".yaml": "yaml",
    ".sql": "sql",
    ".xml": "xml",
    ".toml": "ini",
    ".ini": "ini",
  };
  return map[ext] ?? "plaintext";
}

export { monaco };
