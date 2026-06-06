export class SealInputError extends Error {
  constructor(message: string, public field?: string) {
    super(message)
    this.name = 'SealInputError'
  }
}
