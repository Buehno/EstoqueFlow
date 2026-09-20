/**
 * Comprime uma imagem escolhida pelo usuário (produto ou logotipo) no
 * próprio navegador antes de mandar pro servidor.
 *
 * Por quê comprimir no cliente: o Railway desta implantação não tem volume
 * persistente (`volumeMounts: []`) — não há onde guardar um arquivo de
 * imagem em disco entre deploys. A foto vira uma data URI guardada direto
 * no Postgres (`ProposalItem.imageUrl`, `ProposalTemplateItem.imageUrl`,
 * `Company.logoUrl`, todos `TEXT`). Sem redimensionar, uma foto de celular
 * de 4-8 MB looparia o banco de dados rapidinho; redimensionada e
 * comprimida em JPEG, cada imagem fica na casa de 30-150 KB.
 */
export async function comprimirImagem(
  arquivo: File,
  opcoes: { maxLargura?: number; qualidade?: number } = {},
): Promise<string> {
  const { maxLargura = 640, qualidade = 0.75 } = opcoes;

  const bitmap = await criarBitmap(arquivo);
  const escala = Math.min(1, maxLargura / bitmap.width);
  const largura = Math.max(1, Math.round(bitmap.width * escala));
  const altura = Math.max(1, Math.round(bitmap.height * escala));

  const canvas = document.createElement('canvas');
  canvas.width = largura;
  canvas.height = altura;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Não foi possível processar a imagem neste navegador.');
  // fundo branco — evita que PNGs com transparência virem pretos ao exportar como JPEG
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, largura, altura);
  ctx.drawImage(bitmap as any, 0, 0, largura, altura);

  return canvas.toDataURL('image/jpeg', qualidade);
}

function criarBitmap(arquivo: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    return createImageBitmap(arquivo);
  }
  // fallback para navegadores sem createImageBitmap
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    img.src = URL.createObjectURL(arquivo);
  });
}
