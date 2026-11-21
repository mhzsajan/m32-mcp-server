/** Error types that tool handlers turn into visible tool failures, not transport errors. */
export class M32Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "M32Error";
  }
}

export class M32TimeoutError extends M32Error {
  constructor(message: string) {
    super(message);
    this.name = "M32TimeoutError";
  }
}

export class M32ValueError extends M32Error {
  constructor(message: string) {
    super(message);
    this.name = "M32ValueError";
  }
}

export class M32ShowModeError extends M32Error {
  constructor(message: string) {
    super(message);
    this.name = "M32ShowModeError";
  }
}
