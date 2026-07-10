const keys = {
  APPLE_ID: process.env.APPLE_ID,
  APPLE_TEAM_ID: process.env.APPLE_TEAM_ID,
  APPLE_APP_SPECIFIC_PASSWORD: process.env.APPLE_APP_SPECIFIC_PASSWORD,
  CSC_LINK: process.env.CSC_LINK,
  CSC_KEY_PASSWORD: process.env.CSC_KEY_PASSWORD
};

console.log(`APPLE_ID set: ${keys.APPLE_ID ? "yes" : "no"}`);
console.log(`APPLE_TEAM_ID set: ${keys.APPLE_TEAM_ID ? "yes" : "no"}`);
console.log(`APPLE_APP_SPECIFIC_PASSWORD set: ${keys.APPLE_APP_SPECIFIC_PASSWORD ? "yes" : "no"}`);
console.log(`CSC_LINK length: ${keys.CSC_LINK ? keys.CSC_LINK.length : 0}`);
console.log(`CSC_KEY_PASSWORD set: ${keys.CSC_KEY_PASSWORD ? "yes" : "no"}`);
