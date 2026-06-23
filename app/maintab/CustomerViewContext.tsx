"use client";

import { createContext, useContext } from "react";

export const CONSULTATION_ENDED_STORAGE_KEY = "samsung-vvip-consultation-ended-v1";

export type CustomerViewContextValue = {
  isCustomerView: boolean;
  consultationEnded: boolean;
};

export const CustomerViewContext = createContext<CustomerViewContextValue>({
  isCustomerView: false,
  consultationEnded: false,
});

export function useCustomerView() {
  return useContext(CustomerViewContext);
}
