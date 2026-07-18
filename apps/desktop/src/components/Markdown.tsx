import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

/**
 * Renders agent output as real markdown.
 *
 * Agents answer with tables, code blocks and lists; shown as plain text those
 * become a wall of pipes and backticks. GFM gives us tables and strikethrough,
 * rehype-highlight colours fenced code.
 *
 * Memoised because streaming re-renders this on every delta.
 */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="aiw-md text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          // Tables scroll rather than forcing the whole panel wide.
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-md border">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
          th: ({ children }) => (
            <th className="border-b px-3 py-2 text-left font-medium">{children}</th>
          ),
          td: ({ children }) => <td className="border-b border-border/50 px-3 py-1.5">{children}</td>,

          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-sky-400 underline underline-offset-2 hover:text-sky-300"
            >
              {children}
            </a>
          ),

          ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
          p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,

          h1: ({ children }) => <h1 className="mb-2 mt-4 text-base font-semibold">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 mt-4 text-sm font-semibold">{children}</h2>,
          h3: ({ children }) => (
            <h3 className="mb-1 mt-3 text-sm font-semibold text-muted-foreground">{children}</h3>
          ),

          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-4 border-border" />,

          code: ({ className, children, ...props }) => {
            // Fenced blocks carry a language class; anything else is inline.
            const isBlock = /language-/.test(className ?? "");
            if (!isBlock) {
              return (
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">
                  {children}
                </code>
              );
            }
            return (
              <code className={`${className ?? ""} font-mono text-[11px] leading-relaxed`} {...props}>
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="my-3 overflow-x-auto rounded-md border bg-[#0d0d0f] p-3">{children}</pre>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
