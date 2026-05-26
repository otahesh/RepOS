// IDs and aria-id-reference attributes hold programmatic handles, never
// user-visible text. Term substrings inside them must not be flagged.
export const Dialog = () => (
  <div
    role="dialog"
    aria-labelledby="session-expired-title"
    aria-describedby="session-expired-desc"
    aria-controls="session-actions"
  >
    <h2 id="session-expired-title">Hi</h2>
    <p id="session-expired-desc">Body</p>
    <label htmlFor="session-input">Label</label>
    <input id="session-input" />
  </div>
);
