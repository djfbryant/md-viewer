import type { InfoPage } from './navigation';

export type InfoSection = {
  heading: string;
  paragraphs: string[];
};

export type InfoCopy = {
  title: string;
  eyebrow: string;
  lead: string;
  updated: string;
  sections: InfoSection[];
};

export const infoNav: Array<{ page: InfoPage; label: string }> = [
  { page: 'about', label: 'About' },
  { page: 'privacy', label: 'Privacy' },
  { page: 'acceptable-use', label: 'Acceptable use' },
];

export const infoCopy: Record<InfoPage, InfoCopy> = {
  about: {
    title: 'About MarkShare',
    eyebrow: 'The short version',
    lead: 'MarkShare is a quiet place to write Markdown and hand someone a link. That is the whole product.',
    updated: '14 August 2026',
    sections: [
      {
        heading: 'How sharing works',
        paragraphs: [
          'You write in the browser. Save when you are ready. That creates two links. The share link is read-only. Anyone who has it can read the saved document. The edit link can change or delete it. Keep that one to yourself.',
          'There is no account, no inbox of old drafts, and no public index of what people have written. A document exists because someone has a link.',
        ],
      },
      {
        heading: 'What this is not',
        paragraphs: [
          'It is not a blog, a wiki, or a catalogue of your work. If you need comments, sign-in, or a searchable library, this is the wrong tool. The point is one document, sent on purpose.',
        ],
      },
      {
        heading: 'The tone',
        paragraphs: [
          'The interface stays out of the way on purpose. Paper-coloured, one green accent, two panes on a desk. Light, dark, or whatever your system is already doing. The document is the thing. The chrome is not.',
        ],
      },
    ],
  },
  privacy: {
    title: 'Privacy',
    eyebrow: 'What we keep',
    lead: 'There is no account. The document and the links are the whole relationship.',
    updated: '14 August 2026',
    sections: [
      {
        heading: 'What is stored',
        paragraphs: [
          'When you save, MarkShare keeps the Markdown, a title taken from the first heading, timestamps, any expiry you set, and any images you pasted. Images are PNG, JPEG, WebP, or GIF, up to 5 MB each, twenty per document. That data lives in InstantDB. The app is hosted on Vercel.',
        ],
      },
      {
        heading: 'Who can see a document',
        paragraphs: [
          'A share link is the key. Anyone with that URL can read the saved document and its images. There is no extra gate. Treat a share link the way you would treat a file attached to an email.',
          'The edit link can change the document, replace itself, or delete it. The browser that published a document also remembers edit access locally, so you can return without pasting the edit URL. That memory never appears on the share link.',
        ],
      },
      {
        heading: 'What stays on your machine',
        paragraphs: [
          'This browser stores your theme choice, any remembered edit access, and unpublished local drafts. Those do not go to the server until you save.',
        ],
      },
      {
        heading: 'How long it lasts',
        paragraphs: [
          'A document stays until you delete it or it reaches an expiry you chose. Deleted and expired documents become unavailable immediately. A daily cleanup then removes the records and their images.',
        ],
      },
      {
        heading: 'What we do not collect',
        paragraphs: [
          'MarkShare does not run analytics in the app. It does not ask for an email address. InstantDB and Vercel still see the traffic any host sees, including IP addresses on requests. Application logs record cleanup counts, not document titles or Markdown.',
        ],
      },
      {
        heading: 'Share links stay off the public web',
        paragraphs: [
          'Search engines are told not to index share links, edit links, or the editor. Link previews show the generic MarkShare name and description, never the document title or contents. Following a link in a document does not send the share URL along as a referrer.',
        ],
      },
      {
        heading: 'How we slow abuse',
        paragraphs: [
          'A browser can create 20 documents per hour and upload 60 images per hour. Reloading the page does not reset that budget. Vercel challenges /new requests that omit Accept-Language. These limits slow junk, they do not stop someone who already has a share link.',
        ],
      },
      {
        heading: 'A blunt warning',
        paragraphs: [
          'A link is a poor vault. Do not put passwords, medical records, or anything you cannot afford to leak into a URL that can be forwarded. If someone has the share link, they have the document.',
        ],
      },
    ],
  },
  'acceptable-use': {
    title: 'Acceptable use',
    eyebrow: 'The rules',
    lead: 'Use MarkShare to share Markdown you have the right to share. That is the deal.',
    updated: '14 August 2026',
    sections: [
      {
        heading: 'Fine to do',
        paragraphs: [
          'Write notes, specs, diagrams, and drafts. Paste images that belong in the document. Send a share link to the people who should read it. Set an expiry if the document should vanish on its own.',
        ],
      },
      {
        heading: 'Not fine',
        paragraphs: [
          'Do not use MarkShare for illegal content, malware, or spam. Do not try to break the service, scrape it, or dump material you do not have the right to publish. Do not treat share links as a content-delivery network for bulk files. Automated bulk creation and image upload will be rate-limited.',
        ],
      },
      {
        heading: 'The links are the lock',
        paragraphs: [
          'If you send a share link, assume the recipient can pass it on. If an edit link leaks, replace it. You are responsible for what you publish and who you give the URLs to.',
        ],
      },
      {
        heading: 'We can remove documents',
        paragraphs: [
          'MarkShare can delete a document that breaks these rules or puts the service at risk. There is no account to appeal from. If the document is gone, the share link shows the same unavailable page as an expired or mistyped URL.',
        ],
      },
      {
        heading: 'No warranty',
        paragraphs: [
          'The service is offered as it stands. It can go down, lose a draft, or change. Keep your own copy of anything you cannot afford to lose. Download .md exists for a reason.',
        ],
      },
    ],
  },
};
