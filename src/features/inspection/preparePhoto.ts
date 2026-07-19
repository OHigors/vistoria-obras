import { manipulateAsync, SaveFormat, type Action } from 'expo-image-manipulator';

// Maior lado da foto de vistoria. 1600px preserva o detalhe que importa (trinca,
// rejunte, defeito) num celular/relatório, mas corta ~4–6× o tamanho — antes a foto
// subia na resolução cheia do celular (~4000px, 2–4 MB) e era baixada inteira só
// para exibir uma miniatura de 100×80.
export const MAX_PHOTO_DIM = 1600;

// Prepara a foto para upload:
//  • limita o MAIOR lado a MAX_PHOTO_DIM (preserva proporção; nunca amplia);
//  • re-encoda em JPEG, o que também remove o EXIF (GPS, dispositivo).
// `width`/`height` vêm do ImagePicker; sem eles, limitamos pela largura.
export async function preparePhotoForUpload(uri: string, width?: number, height?: number) {
  const w = width ?? 0;
  const h = height ?? 0;
  const longest = Math.max(w, h);

  const actions: Action[] =
    longest === 0
      ? [{ resize: { width: MAX_PHOTO_DIM } }]
      : longest > MAX_PHOTO_DIM
        ? [{ resize: w >= h ? { width: MAX_PHOTO_DIM } : { height: MAX_PHOTO_DIM } }]
        : []; // já é menor que o limite → só re-encoda (tira EXIF), sem upscale

  return manipulateAsync(uri, actions, { compress: 0.8, format: SaveFormat.JPEG });
}
