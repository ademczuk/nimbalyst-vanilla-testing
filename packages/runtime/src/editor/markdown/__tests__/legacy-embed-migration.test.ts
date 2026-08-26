// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { upgradeLegacyEmbeds } from '../EnhancedMarkdownImport';

describe('upgradeLegacyEmbeds', () => {
  it('migrates sized mockup references to the universal embed link contract', () => {
    expect(
      upgradeLegacyEmbeds(
        '![Tracker Studio](preview.png){mockup:./tracker-studio.mockup.html}{1200x760}',
      ),
    ).toBe('[Tracker Studio](./tracker-studio.mockup.html "width=1200 height=760")');
  });

  it('migrates legacy references without dimensions', () => {
    expect(
      upgradeLegacyEmbeds(
        '![Architecture](diagram.png){mockup:../architecture/system.excalidraw}',
      ),
    ).toBe('[Architecture](../architecture/system.excalidraw)');
  });

  it('migrates the retired data-model linked-image form, keeping its size', () => {
    expect(
      upgradeLegacyEmbeds(
        '[![Billing schema](.datamodel-screenshots/billing.png)](./schemas/billing.prisma){900x640}',
      ),
    ).toBe('[Billing schema](./schemas/billing.prisma "width=900 height=640")');
  });

  it('migrates a data-model reference whose screenshot never generated', () => {
    // The old node wrote an empty screenshot path while the capture was still
    // pending, so this shape is on disk in real documents.
    expect(
      upgradeLegacyEmbeds('[![](/)](./billing.prisma)'),
    ).toBe('[./billing.prisma](./billing.prisma)');
  });

  it('migrates the retired mockup linked-image form, keeping its size', () => {
    expect(
      upgradeLegacyEmbeds(
        '[![Tracker Studio](.previews/tracker.png)](./tracker-studio.mockup.html){1200x760}',
      ),
    ).toBe('[Tracker Studio](./tracker-studio.mockup.html "width=1200 height=760")');
  });

  it('leaves a linked thumbnail pointing at an ordinary file alone', () => {
    // The retired form is only reinterpretable for suffixes that actually
    // shipped a node writing it. A clickable thumbnail is normal CommonMark and
    // rewriting one would drop the image the author put there on purpose.
    const markdown = '[![Full size](thumb.png)](photo.png){800x600}';

    expect(upgradeLegacyEmbeds(markdown)).toBe(markdown);
  });

  it('leaves current embed links and ordinary images unchanged', () => {
    const markdown = [
      '[Architecture](../architecture/system.excalidraw "width=1000 height=650")',
      '[Billing schema](./schemas/billing.prisma "width=900 height=640")',
      '[Tracker Studio](./tracker-studio.mockup.html "width=1200 height=760")',
      '![Screenshot](screenshot.png){800x600}',
    ].join('\n\n');

    expect(upgradeLegacyEmbeds(markdown)).toBe(markdown);
  });
});
