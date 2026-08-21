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
    lead: 'MarkShare is a quiet place for invited people to write Markdown and hand someone a link.',
    updated: '19 August 2026',
    sections: [
      {
        heading: 'How sharing works',
        paragraphs: [
          'Creators are invited. They sign in with an email code, write in the browser, and save when they are ready. That creates a share link. Anyone who has the share link can read the saved document. They do not need an account.',
          'The person who created a document can let another invited creator edit it. The share link stays read-only. There is no public list of what people have written.',
        ],
      },
      {
        heading: 'What this is not',
        paragraphs: [
          'It is not a blog, a wiki, or an open pastebin. If you need comments, public sign-up, or a searchable library, this is the wrong tool. The point is one document, sent on purpose, by people who were invited to write.',
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
    lead: 'Authors are invited. A share link is enough to read. There is no encryption of stored documents.',
    updated: '19 August 2026',
    sections: [
      {
        heading: 'What is stored',
        paragraphs: [
          'When you save, MarkShare keeps the Markdown, a title taken from the first heading, timestamps, any expiry you set, the owner, any editors, and any images you pasted. Images are PNG, JPEG, WebP, or GIF, up to 2 MB each, six per document. Pasted images are kept for 7 days and then become placeholder text in the document. The writing itself stays until the owner deletes it or it reaches an expiry they chose. That data lives in InstantDB in plaintext. The app is hosted on Vercel.',
        ],
      },
      {
        heading: 'Who can see a document',
        paragraphs: [
          'A share link is read access. Anyone with that URL can read the saved document and its images. There is no extra gate for readers.',
          'Only invited creators can write. The owner can grant edit to another creator who has already signed in. Other creators can see creator emails in order to make that grant. Anonymous readers never see that list.',
        ],
      },
      {
        heading: 'What the operator can see',
        paragraphs: [
          'The operator can read and delete stored documents. MarkShare does not encrypt. It does not scan every document. The operator will act if they look, or if they are asked.',
        ],
      },
      {
        heading: 'What stays on your machine',
        paragraphs: [
          'This browser stores your theme choice and unpublished local drafts for the signed-in creator. Those do not go to the server until you save. Drafts do not follow you to another browser.',
        ],
      },
      {
        heading: 'How long it lasts',
        paragraphs: [
          'A document stays until the owner deletes it or it reaches an expiry they chose. Pasted images are removed after 7 days; the Markdown stays and readers see placeholder text where the picture was. Deleted and expired documents become unavailable immediately. A daily cleanup then removes the records and any remaining images.',
        ],
      },
      {
        heading: 'What we do not collect',
        paragraphs: [
          'MarkShare does not run analytics in the app. InstantDB and Vercel still see the traffic any host sees, including IP addresses on requests. Application logs record cleanup counts, not document titles or Markdown.',
        ],
      },
      {
        heading: 'Share links stay off the public web',
        paragraphs: [
          'Search engines are told not to index share links, the editor, or sign-in. Link previews show the generic MarkShare name and description, never the document title or contents. Following a link in a document does not send the share URL along as a referrer.',
        ],
      },
      {
        heading: 'How we slow abuse',
        paragraphs: [
          'A signed-in creator can create 20 documents per hour and upload 60 images per hour. Reloading the page does not reset that budget. These limits slow junk. They do not stop someone who already has a share link.',
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
    updated: '19 August 2026',
    sections: [
      {
        heading: 'Fine to do',
        paragraphs: [
          'Write notes, specs, diagrams, and drafts. Paste images that belong in the document. Send a share link to the people who should read it. Grant edit to another invited creator if they should write too. Set an expiry if the document should vanish on its own.',
        ],
      },
      {
        heading: 'Not fine',
        paragraphs: [
          'Do not use MarkShare for illegal content, malware, or spam. Do not try to break the service, scrape it, or dump material you do not have the right to publish. Do not treat share links as a content-delivery network for bulk files. The app rate-limits bulk creation per signed-in creator; someone who works around those limits should expect their invitation to be revoked.',
        ],
      },
      {
        heading: 'The links are the lock',
        paragraphs: [
          'If you send a share link, assume the recipient can pass it on. The owner is responsible for who they grant edit to. You are responsible for what you publish.',
        ],
      },
      {
        heading: 'We can remove documents and revoke creators',
        paragraphs: [
          'MarkShare can delete a document that breaks these rules or puts the service at risk. The operator can revoke a creator. Revoked creators cannot sign in to write. Published share links stay until that document is deleted. If the document is gone, the share link shows the same unavailable page as an expired or mistyped URL.',
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
