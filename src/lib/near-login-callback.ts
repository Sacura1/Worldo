import {completeNearLogin, markEntryResume} from './near-login';
import {t} from './i18n';
import './near-login.css';

export async function showNearLoginCallback(search: string) {
  document.title = 'Worldo';
  const main = document.createElement('main');
  main.className = 'near-login-result';
  const card = document.createElement('section');
  const title = document.createElement('h1');
  title.textContent = 'WORLDO';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.textContent = t('Completing sign-in…');
  const back = document.createElement('a');
  back.href = '/';
  back.textContent = t('Return to Worldo.');
  card.append(title, status);
  main.append(card);
  document.getElementById('root')!.replaceChildren(main);
  try {
    await completeNearLogin(search);
    status.textContent = t('Signed in. Finishing account setup…');
    // Back to the game in this tab, which carries on from the player's click.
    markEntryResume();
    window.location.replace('/');
  } catch (error) {
    status.textContent = t(
      error instanceof Error ? error.message : 'Could not verify your NEAR sign-in. Please try again.',
    );
    card.append(back);
  }
}
