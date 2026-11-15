'use strict';
/** Rejects the passwords attackers try first, even when they satisfy the upper/lower/number rule ("Password123"). */
const COMMON = new Set(`password,password1,password12,password123,password1234,passw0rd,p@ssw0rd,p@ssword,qwerty,qwerty123,qwertyuiop,qwerty1234,1qaz2wsx,1q2w3e4r,1q2w3e4r5t,asdfghjkl,zxcvbnm,iloveyou,iloveyou1,letmein,letmein123,welcome,welcome1,welcome123,admin,admin123,admin1234,administrator,abc123,abcd1234,abcdefghij,monkey,dragon,master,sunshine,princess,football,baseball,superman,batman,trustno1,changeme,changeme123,default,secret,secret123,test1234,testing123,india123,india@123,bharat123,krishna123,jaishreeram,hanuman123,ganesh123,shiva123,sachin10,virat18,mypassword,mypassword1,presethub,presethub1,presethub123,lightroom,lightroom123`.split(','));

function isCommonPassword(value, ctx = {}) {
  const p = String(value || '').toLowerCase();
  if (!p) return true;
  if (COMMON.has(p)) return true;
  const letters = p.replace(/[^a-z]/g, '');
  const rest = p.replace(/[a-z]/g, '');
  // a common word followed only by digits/symbols: "password2024!", "welcome@786"
  if (letters && COMMON.has(letters) && /^[0-9!@#$%^&*._-]*$/.test(rest)) return true;
  if (/^(.)\1+$/.test(p)) return true;                                   // aaaaaaaaaa
  if (/^(?:0123456789|1234567890|9876543210|abcdefghij)/.test(p)) return true; // simple runs
  const local = String(ctx.email || '').split('@')[0].toLowerCase();
  if (local.length >= 4 && p.includes(local)) return true;               // password contains the e-mail name
  return false;
}
const COMMON_MESSAGE = 'This password is too common or easy to guess. Please choose a less predictable one.';
module.exports = { isCommonPassword, COMMON_MESSAGE };
