// Upload validado de foto de vistoria.
//
// POR QUE ESTA FUNÇÃO EXISTE: o bucket já limita tamanho e MIME, mas o MIME que
// ele confere é o CABEÇALHO DECLARADO pelo cliente — não os bytes. Qualquer
// arquivo enviado com Content-Type "image/jpeg" passa. Validar a assinatura do
// arquivo exige ler o conteúdo, e isso só tem valor no servidor: checagem no
// cliente é conferir a própria afirmação de quem envia.
//
// A função é a ÚNICA porta com poder de gravar (usa a service_role, injetada
// pela plataforma — nunca vai para o bundle). Por isso ela repete aqui todas as
// checagens que as políticas de RLS fariam: sessão, papel na obra e escopo do
// caminho. A service_role ignora RLS; o que não for checado aqui não é checado.
//
// Contrato: POST com os bytes da imagem no corpo e o destino no header
// `x-photo-path`. Responde { path } em caso de sucesso.

import { createClient } from 'npm:@supabase/supabase-js@2';

const BUCKET = 'inspection-photos';
const MAX_BYTES = 10 * 1024 * 1024;
const WRITE_ROLES = ['admin', 'owner', 'editor'];

// Só o que o bucket aceita. O tipo vem da ASSINATURA do arquivo, nunca do header.
const sniffImageType = (b: Uint8Array): string | null => {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return 'image/png';
  }
  // RIFF....WEBP
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
};

// `obraId/.../arquivo.jpg` — o 1º segmento é a obra (mesmo escopo das políticas
// de Storage). Sem `..` e sem barra inicial: o caminho não pode escapar da pasta.
const PATH_RE = /^[0-9a-fA-F-]{36}\/[A-Za-z0-9][A-Za-z0-9/_.-]*$/;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-photo-path',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const fail = (status: number, message: string) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return fail(405, 'Método não permitido.');

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return fail(401, 'Sessão ausente.');

  const path = req.headers.get('x-photo-path') ?? '';
  if (!PATH_RE.test(path) || path.includes('..')) {
    return fail(400, 'Caminho de destino inválido.');
  }

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Identidade: validada com o token do usuário, nunca com a service_role.
  const asUser = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await asUser.auth.getUser();
  if (userError || !userData.user) return fail(401, 'Sessão inválida.');

  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength === 0) return fail(400, 'Arquivo vazio.');
  if (bytes.byteLength > MAX_BYTES) return fail(413, 'Foto excede 10 MB.');

  const contentType = sniffImageType(bytes);
  if (!contentType) return fail(415, 'Arquivo não é uma imagem JPEG, PNG ou WebP.');

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Papel na obra do caminho — a service_role ignora RLS, então o vínculo é
  // conferido explicitamente aqui.
  const obraId = path.split('/')[0];
  const { data: membership, error: membershipError } = await admin
    .from('user_obras')
    .select('role')
    .eq('user_id', userData.user.id)
    .eq('obra_id', obraId)
    .maybeSingle();

  if (membershipError) return fail(500, 'Falha ao verificar permissão.');
  if (!membership || !WRITE_ROLES.includes(membership.role)) {
    return fail(403, 'Sem permissão para enviar fotos nesta obra.');
  }

  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType, upsert: false });

  if (uploadError) return fail(409, uploadError.message);

  return new Response(JSON.stringify({ path }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});
