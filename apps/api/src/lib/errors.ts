export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code = 'APP_ERROR',
    public details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (m: string, details?: unknown) =>
  new AppError(400, m, 'BAD_REQUEST', details);
export const unauthorized = (m = 'Não autenticado') => new AppError(401, m, 'UNAUTHORIZED');
export const forbidden = (m = 'Sem permissão para esta ação') => new AppError(403, m, 'FORBIDDEN');
export const notFound = (m = 'Registro não encontrado') => new AppError(404, m, 'NOT_FOUND');
export const conflict = (m: string) => new AppError(409, m, 'CONFLICT');
export const unprocessable = (m: string, details?: unknown) =>
  new AppError(422, m, 'UNPROCESSABLE', details);
export const passwordChangeRequired = () =>
  new AppError(403, 'Troca de senha obrigatória antes de continuar.', 'SENHA_PROVISORIA');
