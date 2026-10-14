import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Client } from 'discord.js';
import { AVATAR_FILE } from './config.js';
import { logger } from './logger.js';
import type { GuildStore } from './storage/GuildStore.js';

/**
 * Usa assets/icone.png como foto de perfil. O Discord limita trocas de avatar, então só
 * envia a imagem quando ela muda (comparando o hash com o último envio).
 */
export async function syncAvatar(client: Client<true>, store: GuildStore): Promise<void> {
  let image: Buffer;
  try {
    image = await readFile(AVATAR_FILE);
  } catch {
    logger.warn(`Avatar não encontrado em ${AVATAR_FILE}; mantendo a foto atual.`);
    return;
  }

  const hash = createHash('sha256').update(image).digest('hex');
  if (hash === store.avatarHash && client.user.avatar) return;

  try {
    await client.user.setAvatar(image);
    await store.setAvatarHash(hash);
    logger.info('Foto de perfil atualizada a partir de icone.png.');
  } catch (error) {
    logger.warn(
      'Não consegui atualizar a foto de perfil (o Discord limita trocas frequentes; tentarei no próximo início).',
      (error as Error).message,
    );
  }
}
