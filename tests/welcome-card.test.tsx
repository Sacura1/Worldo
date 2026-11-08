import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {WelcomeCard} from '../src/city/WelcomeCard';
import {NEAR_AUTH_AWAITING_APPROVAL} from '../shared/near-auth';

const screen = (settings: {
  localMode: boolean;
  authConfigured: boolean;
  guestPlay: boolean;
  hasIdentity?: boolean;
  authorized?: boolean;
  awaitingApproval?: boolean;
}) =>
  renderToStaticMarkup(
    <WelcomeCard
      configLoaded
      connectionFailed={false}
      hasIdentity={false}
      authorized={false}
      busy={false}
      ready
      onPlay={() => {}}
      onGuest={() => {}}
      onRetry={() => {}}
      {...settings}
    />,
  );

describe('welcome buttons', () => {
  it('offers NEAR sign-in and guest play together when both are switched on', () => {
    const page = screen({localMode: false, authConfigured: true, guestPlay: true});
    expect(page).toContain('Create account &amp; play');
    expect(page).toContain('Play as guest');
  });

  it('keeps NEAR sign-in as the only choice when guest play is off', () => {
    const page = screen({localMode: false, authConfigured: true, guestPlay: false});
    expect(page).toContain('Create account &amp; play');
    expect(page).not.toContain('Play as guest');
  });

  it('shows only guest play in a local game, which has no chain or sign-in', () => {
    const page = screen({localMode: true, authConfigured: false, guestPlay: false});
    expect(page).toContain('Play as guest');
    expect(page).not.toContain('Create account');
  });

  it('shows only guest play where sign-in is off for that site', () => {
    const page = screen({localMode: false, authConfigured: false, guestPlay: true});
    expect(page).toContain('Play as guest');
    expect(page).not.toContain('Create account');
  });

  it('lets a returning player go straight in', () => {
    const page = screen({localMode: false, authConfigured: true, guestPlay: true, hasIdentity: true, authorized: true});
    expect(page).toContain('Enter Worldo');
    expect(page).not.toContain('Play as guest');
  });

  it('explains the wait for NEAR Auth approval and offers guest play', () => {
    const page = screen({localMode: false, authConfigured: true, guestPlay: true, awaitingApproval: true});
    expect(page).toContain('role="dialog"');
    expect(page).toContain('Waiting for NEAR Auth approval');
    expect(page).toContain(NEAR_AUTH_AWAITING_APPROVAL);
    expect(page).toContain('You can play as a guest for now.');
  });

  it('does not offer guest play in that message where guest play is off', () => {
    const page = screen({localMode: false, authConfigured: true, guestPlay: false, awaitingApproval: true});
    expect(page).toContain(NEAR_AUTH_AWAITING_APPROVAL);
    expect(page).not.toContain('Play as guest');
  });

  it('shows no waiting message until a sign-in has been refused', () => {
    const page = screen({localMode: false, authConfigured: true, guestPlay: true});
    expect(page).not.toContain('role="dialog"');
    expect(page).not.toContain(NEAR_AUTH_AWAITING_APPROVAL);
  });
});
