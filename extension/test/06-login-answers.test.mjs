// 0.8.1: how the portal's answer to a Login press is read (content.js,
// LOGIN_REFUSALS / LOGIN_CAPTCHA_RX / classifyLogin). A refused user ID or
// password, or a locked or expired account, must read as a refusal (the client
// is left and the password never offered again); a CAPTCHA typo must not (it is
// tried again); the login form's own labels must never read as anything.
// Runs the shipped code: the block is cut out of content.js, as _extract.mjs does.
//   node test/06-login-answers.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../content.js', import.meta.url), 'utf8');
const c0 = src.indexOf('  const LOGIN_ERR_SEL');
const c1 = src.indexOf('  };', src.indexOf('  const REFUSAL_WORDS')) + 4;
const f0 = src.indexOf('  function classifyLogin(msgs) {');
const f1 = src.indexOf('\n  }\n', f0) + 4;
if (c0 < 0 || c1 < 4 || f0 < 0 || f1 < 4) throw new Error('login answer block not found in content.js');
const ctx = vm.createContext({});
vm.runInContext(src.slice(c0, c1) + '\n' + src.slice(f0, f1) + '\nthis.classifyLogin = classifyLogin;', ctx);
const classify = (msgs) => ctx.classifyLogin(msgs);

let fail = 0;
const ok = (cond, name) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) fail++; };
const is = (msg, kind, reason) => {
  const v = classify([msg]);
  ok(v.kind === kind && (!reason || v.reason === reason), `${JSON.stringify(msg)} -> ${kind}${reason ? ' (' + reason + ')' : ''}` + (v.kind !== kind || (reason && v.reason !== reason) ? `  [got ${v.kind}${v.reason ? ' ' + v.reason : ''}]` : ''));
};

// Refusals: the client is left and the password remembered as refused.
is('Invalid Username or Password. Please try again.', 'refused', 'wrong_password');
is('The username or password you entered is incorrect.', 'refused', 'wrong_password');
is('Invalid credentials', 'refused', 'wrong_password');
is('Wrong password', 'refused', 'wrong_password');
is('Incorrect User ID', 'refused', 'wrong_password');
is('User ID does not exist', 'refused', 'wrong_password');
is('Login failed: password does not match', 'refused', 'wrong_password');
is('Your password has expired. Please change your password.', 'refused', 'password_expired');
is('Your account has been locked for 30 minutes due to multiple failed attempts.', 'refused', 'account_locked');
is('User ID is blocked. Please reset your password.', 'refused', 'account_locked');
is('You have exceeded the maximum number of login attempts.', 'refused', 'account_locked');
is('Too many attempts. Try again later.', 'refused', 'account_locked');

// A CAPTCHA typo: tried again with a fresh CAPTCHA.
is('Enter valid Letters shown.', 'captcha');
is('Invalid Captcha', 'captcha');
is('Please enter the characters shown in the image', 'captcha');
is('Invalid username, password or captcha', 'other'); // both at once: one more try, never a mark

// Anything else: one more try, then the client is logged and left.
is('Something went wrong. Please try again later.', 'other');
is('System is under maintenance', 'other');

// The form's own words are not an answer.
for (const label of ['Username', 'Password', 'Forgot Password', 'Forgot Username', 'Password is case sensitive',
  'Type the characters you see in the image below', 'First time login: If you are logging in for the first time, click here',
  'Your password will expire in 5 days', 'Enter valid Username']) {
  ok(classify([label]).kind !== 'refused', `label ${JSON.stringify(label)} is never a refusal`);
}

// A refusal wins over an earlier message that is not one; nothing shown is 'none'.
const two = classify(['Enter valid Letters shown.', 'Invalid Username or Password. Please try again.']);
ok(two.kind === 'refused', 'a refusal among other messages is still a refusal');
ok(classify([]).kind === 'none', 'nothing shown: none');

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
