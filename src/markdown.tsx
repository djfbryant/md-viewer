import { Children, isValidElement, useEffect, useId, useState, type ReactNode } from 'react';
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { toString } from 'mdast-util-to-string';
import { unified } from 'unified';
import type { Heading, Root } from 'mdast';

const markdownParser = unified().use(remarkParse).use(remarkGfm);
const remarkPlugins = [remarkGfm];
const rehypePlugins: NonNullable<React.ComponentProps<typeof ReactMarkdown>['rehypePlugins']> = [
  [rehypeHighlight, { plainText: ['mermaid'] }],
];

export type InterpretedMarkdown = {
  download: {
    content: string;
    filename: string;
    mediaType: 'text/markdown;charset=utf-8';
  };
  source: string;
  title: string;
};

function filenameFor(title: string) {
  const withoutControlCharacters = [...title]
    .map((character) => character.charCodeAt(0) < 32 ? '-' : character)
    .join('');
  const safeTitle = withoutControlCharacters
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 100);
  return `${safeTitle || 'Untitled document'}.md`;
}

export function interpretMarkdown(source: string): InterpretedMarkdown {
  const tree = markdownParser.parse(source) as Root;
  const heading = tree.children.find(
    (node): node is Heading => node.type === 'heading' && node.depth === 1,
  );
  const title = heading ? toString(heading).trim() || 'Untitled document' : 'Untitled document';

  return {
    download: {
      content: source,
      filename: filenameFor(title),
      mediaType: 'text/markdown;charset=utf-8',
    },
    source,
    title,
  };
}

export function downloadMarkdown(document: InterpretedMarkdown) {
  const blob = new Blob([document.download.content], { type: document.download.mediaType });
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement('a');
  link.download = document.download.filename;
  link.href = url;
  link.hidden = true;
  window.document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

let mermaidApiPromise: Promise<typeof import('mermaid')['default']> | undefined;

function getMermaidApi() {
  mermaidApiPromise ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({
      flowchart: { htmlLabels: false },
      securityLevel: 'strict',
      startOnLoad: false,
      suppressErrorRendering: true,
    });
    return mermaid;
  });
  return mermaidApiPromise;
}

type MermaidState =
  | { kind: 'loading' }
  | { kind: 'rendered'; svg: string }
  | { kind: 'invalid' };

function MermaidDiagram({ source }: { source: string }) {
  const reactId = useId();
  const [state, setState] = useState<MermaidState>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    setState({ kind: 'loading' });

    void getMermaidApi()
      .then((mermaid) => mermaid.render(`markshare-mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`, source))
      .then(({ svg }) => {
        if (active) setState({ kind: 'rendered', svg });
      })
      .catch(() => {
        if (active) setState({ kind: 'invalid' });
      });

    return () => { active = false; };
  }, [reactId, source]);

  if (state.kind === 'rendered') {
    return <div className="mermaid-diagram" dangerouslySetInnerHTML={{ __html: state.svg }} />;
  }

  if (state.kind === 'invalid') {
    return <figure className="mermaid-fallback">
      <figcaption>This diagram could not be rendered safely.</figcaption>
      <pre><code className="language-mermaid">{source}</code></pre>
    </figure>;
  }

  return <div className="mermaid-loading" role="status">Rendering diagram…</div>;
}

function mermaidSource(children: ReactNode) {
  const child = Children.toArray(children)[0];
  if (!isValidElement<{ className?: string; children?: ReactNode }>(child)) return null;
  if (!child.props.className?.split(' ').includes('language-mermaid')) return null;
  return String(child.props.children ?? '').replace(/\n$/, '');
}

const markdownComponents: Components = {
  a({ node, ...props }) {
    void node;
    return props.href ? <a {...props} /> : <span>{props.children}</span>;
  },
  pre({ children }) {
    const source = mermaidSource(children);
    return source === null ? <pre>{children}</pre> : <MermaidDiagram source={source} />;
  },
};

function safeMarkdownUrl(url: string) {
  return defaultUrlTransform(url);
}

export function MarkdownView({ document }: { document: InterpretedMarkdown }) {
  return <ReactMarkdown
    components={markdownComponents}
    rehypePlugins={rehypePlugins}
    remarkPlugins={remarkPlugins}
    skipHtml
    urlTransform={safeMarkdownUrl}
  >
    {document.source}
  </ReactMarkdown>;
}
