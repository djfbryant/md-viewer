import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CREATE_DOCUMENT_LIMIT, UPLOAD_IMAGE_LIMIT } from './document-lifecycle';
import {
  PRIVATE_ROBOTS,
  PUBLIC_PREVIEW_DESCRIPTION,
  PUBLIC_PREVIEW_TITLE,
  PUBLIC_ROBOTS,
  REFERRER_POLICY,
  responseHeadersFor,
  robotsTxt,
} from './navigation';
import { infoCopy } from './public-information';

const root = process.cwd();
const analytics = /gtag\(|googletagmanager|google-analytics|plausible\(|posthog|mixpanel|segment\.com|hotjar|fullstory|@vercel\/analytics|vercel.*insights/i;

type HeaderRule = {
  source: string;
  headers: Array<{ key: string; value: string }>;
};

function headerMap(headers: Array<{ key: string; value: string }>) {
  return Object.fromEntries(headers.map((header) => [header.key, header.value]));
}

describe('privacy and abuse deployment', () => {
  it('ships generic link-preview metadata and no analytics in the HTML shell', () => {
    const html = readFileSync(join(root, 'index.html'), 'utf8');
    expect(html).toContain(`<title>${PUBLIC_PREVIEW_TITLE}</title>`);
    expect(html).toContain(`content="${PUBLIC_PREVIEW_DESCRIPTION}"`);
    expect(html).toContain(`<meta name="referrer" content="${REFERRER_POLICY}" />`);
    expect(html).toContain(`<meta property="og:title" content="${PUBLIC_PREVIEW_TITLE}" />`);
    expect(html).toContain(`<meta property="og:description" content="${PUBLIC_PREVIEW_DESCRIPTION}" />`);
    expect(html).toContain(`<meta name="twitter:title" content="${PUBLIC_PREVIEW_TITLE}" />`);
    expect(html).not.toMatch(analytics);
  });

  it('does not load analytics from the app entry or package manifest', () => {
    expect(readFileSync(join(root, 'src/main.tsx'), 'utf8')).not.toMatch(analytics);
    expect(readFileSync(join(root, 'src/App.tsx'), 'utf8')).not.toMatch(analytics);
    expect(readFileSync(join(root, 'package.json'), 'utf8')).not.toMatch(analytics);
  });

  it('deploys the same robots file and Share Link headers the navigation module emits', () => {
    expect(readFileSync(join(root, 'public/robots.txt'), 'utf8')).toBe(robotsTxt());
    const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')) as {
      headers: HeaderRule[];
      routes?: Array<{ src: string; missing?: unknown; mitigate?: { action: string } }>;
    };
    const bySource = Object.fromEntries(vercel.headers.map((rule) => [rule.source, headerMap(rule.headers)]));
    expect(bySource['/(.*)']).toEqual(headerMap(responseHeadersFor('/s/opaque-id')));
    expect(bySource['/(.*)']).toEqual(headerMap(responseHeadersFor('/secret-notes')));
    expect(bySource['/']).toEqual({ 'X-Robots-Tag': PUBLIC_ROBOTS });
    expect(bySource['/about']).toEqual({ 'X-Robots-Tag': PUBLIC_ROBOTS });
    expect(bySource['/about/']).toEqual({ 'X-Robots-Tag': PUBLIC_ROBOTS });
    expect(bySource['/privacy']).toEqual({ 'X-Robots-Tag': PUBLIC_ROBOTS });
    expect(bySource['/privacy/']).toEqual({ 'X-Robots-Tag': PUBLIC_ROBOTS });
    expect(bySource['/acceptable-use']).toEqual({ 'X-Robots-Tag': PUBLIC_ROBOTS });
    expect(bySource['/acceptable-use/']).toEqual({ 'X-Robots-Tag': PUBLIC_ROBOTS });
    expect(bySource['/(.*)']['X-Robots-Tag']).toBe(PRIVATE_ROBOTS);
    expect(vercel.routes).toEqual([{
      src: '/new',
      missing: [{ type: 'header', key: 'accept-language' }],
      mitigate: { action: 'challenge' },
    }]);
  });

  it('describes the same rate limits and privacy behaviour the app enforces', () => {
    const privacy = infoCopy.privacy.sections.flatMap((section) => section.paragraphs).join(' ');
    const acceptableUse = infoCopy['acceptable-use'].sections.flatMap((section) => section.paragraphs).join(' ');
    expect(privacy).toContain(`${CREATE_DOCUMENT_LIMIT.max} documents per hour`);
    expect(privacy).toContain(`${UPLOAD_IMAGE_LIMIT.max} images per hour`);
    expect(privacy).toContain('does not run analytics');
    expect(privacy).toContain('never the document title or contents');
    expect(privacy).toContain('does not send the share URL along as a referrer');
    expect(privacy).toContain('signed-in creator');
    expect(privacy).toContain('does not reset that budget');
    expect(privacy).toContain('cleanup counts, not document titles or Markdown');
    expect(acceptableUse).toContain('rate-limits bulk creation');
    expect(acceptableUse).toContain('invitation to be revoked');
  });
});
