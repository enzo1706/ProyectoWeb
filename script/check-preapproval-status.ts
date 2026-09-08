import { getSubscriptionPreapproval } from "../server/mercadopago";

const id = process.argv[2];
if (!id) {
  console.error("Uso: tsx script/check-preapproval-status.ts <preapproval_id>");
  process.exit(1);
}

getSubscriptionPreapproval(id)
  .then((res) => {
    console.log(JSON.stringify({
      id: res.id,
      status: res.status,
      reason: res.reason,
      external_reference: res.external_reference,
      payer_email: res.payer_email,
      payer_id: res.payer_id,
      auto_recurring: res.auto_recurring,
      init_point: res.init_point,
      date_created: res.date_created,
      last_modified: res.last_modified,
      next_payment_date: res.next_payment_date,
    }, null, 2));
  })
  .catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
