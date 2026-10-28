// GitLab tokens entered in the settings panel are stored encrypted with the OS keystore
// (DPAPI on Windows) as tokenEnc; a plain "token" put in the file by hand is still read.
const { safeStorage } = require('electron');

// Fields to store for `token`: { tokenEnc } when the keystore is available, else { token }.
function seal(token) {
  if (safeStorage.isEncryptionAvailable()) return { token: '', tokenEnc: safeStorage.encryptString(token).toString('base64') };
  return { token };
}

function reveal(account) {
  if (account.token) return account.token;
  if (!account.tokenEnc) return '';
  try {
    return safeStorage.decryptString(Buffer.from(account.tokenEnc, 'base64'));
  } catch {
    return ''; // encrypted on another machine or user account
  }
}

module.exports = { seal, reveal };
