/** A safe, player-facing failure. Credentials and provider payloads never belong here. */
export class GameError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = 'GameError';
  }
}
