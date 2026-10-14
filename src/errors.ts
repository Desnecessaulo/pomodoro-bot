/** Erro esperado, cuja mensagem pode ser mostrada diretamente ao usuário. */
export class UserError extends Error {
  override name = 'UserError';
}
