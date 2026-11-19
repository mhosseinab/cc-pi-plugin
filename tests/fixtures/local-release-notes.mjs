import { generateNotes as generateReleaseNotes } from '@semantic-release/release-notes-generator';

/** Generate real notes without replacing the fixture's local Git publication target. */
export function generateNotes(config, context) {
  return generateReleaseNotes(config, {
    ...context,
    options: {
      ...context.options,
      // The notes generator builds links locally; it makes no request to this URL.
      repositoryUrl: 'https://github.com/example/cc-pi-plugin',
    },
  });
}
