export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly details?: string[],
  ) {
    super(message);
    this.name = "HttpError";
  }
}
