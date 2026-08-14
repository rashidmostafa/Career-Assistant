const passport = require('../config/passport');

describe('passport bootstrap', () => {
  it('does not throw when OAuth credentials are missing', () => {
    const original = {
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    };

    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;

    const app = { use: jest.fn() };

    expect(() => passport.initPassport(app)).not.toThrow();

    Object.entries(original).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  });
});
