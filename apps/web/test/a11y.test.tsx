// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import axe from 'axe-core';
import { Sidebar } from '@/components/shell/Sidebar';
import { AuthCard, inputClass } from '@/components/AuthCard';
import { A11yEnhancements } from '@/components/A11yEnhancements';
import { visibleSections } from '@/lib/navigation';
import { ThemeProvider } from '@/context/ThemeContext';

// Accessibility regressions that need a DOM: axe-core on the shared building blocks, and the keyboard behaviour
// that A11yEnhancements adds to every modal dialog and tab list. Colour contrast needs real layout, so it is
// covered separately, by the token test (contrast.test.ts) and by the browser audit in docs/accessibility.md.

afterEach(cleanup);

async function violations(container: HTMLElement) {
  const result = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
    // Fragments have no page around them; jsdom has no layout, so contrast and size rules cannot run.
    rules: { region: { enabled: false }, 'color-contrast': { enabled: false }, 'target-size': { enabled: false }, 'landmark-one-main': { enabled: false }, 'page-has-heading-one': { enabled: false } },
  });
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`);
}

describe('axe on shared components', () => {
  for (const area of ['student', 'teacher', 'admin', 'platform'] as const)
    for (const variant of ['rail', 'drawer'] as const)
      it(`the ${variant} sidebar of the ${area} area has no violations`, async () => {
        const sections = visibleSections(area, { privacy: () => {}, people: () => {} }, 'SUPER_ADMIN');
        const { container } = render(
          <Sidebar area={area} sections={sections} activeKey={sections[0]?.items[0]?.key} variant={variant} onSelect={() => {}} onClose={() => {}} user={{ name: 'Ada Lovelace', role: 'SUPER_ADMIN' }} onOpenPrivacy={() => {}} onSignOut={() => {}} />,
        );
        expect(await violations(container)).toEqual([]);
      });

  it('the sign-in card with a labelled form has no violations', async () => {
    const { container } = render(
      <ThemeProvider>
      <AuthCard title="Sign in" subtitle="Welcome back">
        <form>
          <label htmlFor="e">E-mail</label>
          <input id="e" type="email" autoComplete="username" className={inputClass} />
          <button type="submit">Sign in</button>
        </form>
      </AuthCard>
      </ThemeProvider>,
    );
    expect(await violations(container)).toEqual([]);
  });
});

function Opener() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <A11yEnhancements />
      <button onClick={() => setOpen(true)}>Open</button>
      {open && (
        <div role="dialog" aria-modal="true" aria-label="Settings">
          <input aria-label="First" />
          <button onClick={() => setOpen(false)}>Close</button>
        </div>
      )}
      <button>Behind</button>
    </div>
  );
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 40)); });

describe('modal dialogs', () => {
  it('take focus in, keep Tab inside, and give focus back to the opener', async () => {
    const { getByText, getByLabelText } = render(<Opener />);
    const opener = getByText('Open');
    opener.focus();
    fireEvent.click(opener);
    await flush();
    expect(document.activeElement).toBe(getByLabelText('First'));

    const close = getByText('Close');
    close.focus();
    // Tab from the last control wraps to the first, instead of leaving for "Behind".
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(getByLabelText('First'));
    // Shift+Tab from the first wraps to the last.
    const back = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(back);
    expect(document.activeElement).toBe(close);

    fireEvent.click(close);
    await flush();
    expect(document.activeElement).toBe(opener);
  });

  it('have no violations while open', async () => {
    const { getByText, container } = render(<Opener />);
    fireEvent.click(getByText('Open'));
    await flush();
    expect(await violations(container)).toEqual([]);
  });
});

describe('tab lists', () => {
  function Tabs() {
    const [i, setI] = useState(0);
    return (
      <div>
        <A11yEnhancements />
        <div role="tablist" aria-label="Views">
          {['One', 'Two', 'Three'].map((t, n) => (
            <button key={t} role="tab" aria-selected={i === n} tabIndex={i === n ? 0 : -1} onClick={() => setI(n)}>
              {t}
            </button>
          ))}
        </div>
      </div>
    );
  }

  it('move with the arrow keys, wrap around, and jump with Home and End', async () => {
    const { getByRole } = render(<Tabs />);
    const tab = (name: string) => getByRole('tab', { name });
    tab('One').focus();
    fireEvent.keyDown(tab('One'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tab('Two'));
    expect(tab('Two').getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tab('Two'), { key: 'End' });
    expect(document.activeElement).toBe(tab('Three'));
    fireEvent.keyDown(tab('Three'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tab('One'));
    fireEvent.keyDown(tab('One'), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tab('Three'));
    fireEvent.keyDown(tab('Three'), { key: 'Home' });
    expect(document.activeElement).toBe(tab('One'));
  });
});
