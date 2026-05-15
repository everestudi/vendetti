import { getSecret } from '../src/lib/secrets';
async function main() {
  const secret = await getSecret('ZAPI_WEBHOOK_SECRET');
  const instId = await getSecret('ZAPI_INSTANCE');
  const token = await getSecret('ZAPI_TOKEN');
  const clientToken = await getSecret('ZAPI_CLIENT_TOKEN');
  console.log(JSON.stringify({
    webhookSecretFull: secret,
    instanceId: instId,
    instanceTokenFull: token,
    clientTokenFull: clientToken,
  }, null, 2));
}
main().catch(e=>{console.error(e);process.exit(1)});
