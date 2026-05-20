/**
 * /chat — redireciona pra /empresa, onde o chat com Augusto vive embedded
 * junto da sidebar de agentes + feed da empresa.
 *
 * Decisão de UX: 1 página só pra o Luís (humano) — sem pular entre /chat
 * e /empresa pra ver Augusto + os outros. Tudo num lugar.
 */

import { redirect } from 'next/navigation';

export default function ChatPage() {
  redirect('/empresa');
}
