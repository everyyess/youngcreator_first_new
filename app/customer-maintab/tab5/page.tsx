import { redirect } from "next/navigation";

export default function LegacyCustomerTab5Page() {
  redirect("/customer-maintab/tab3?innerTab=product-rebalancing");
}
