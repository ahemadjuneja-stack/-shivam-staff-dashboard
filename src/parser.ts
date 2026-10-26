import { Customer, CustomerBill } from './types';

export interface ParsedSheetData {
  city: string;
  customers: {
    customer: Omit<Customer, 'id'>;
    bills: Omit<CustomerBill, 'id'>[];
  }[];
  totalOpening: number;
  totalBills: number;
}

// Cleans Indian currency string e.g. "1,06,024.00" or "50,000" into a clean number
export function parseIndianNumber(val: string): number {
  if (!val) return 0;
  const cleaned = val.replace(/,/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

export function parseMiracleSheet(rawText: string, defaultCity: string = ''): ParsedSheetData {
  const lines = rawText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

  let detectedCity = defaultCity;
  const customersMap: Map<string, { customer: Omit<Customer, 'id'>; bills: Omit<CustomerBill, 'id'>[] }> = new Map();
  let currentCustomerCode: string | null = null;

  // Regex patterns per locked specification
  // Route / City header: e.g., "ROUTE: DEESA" or "CITY: UNJHA-MAHESANA"
  const routeRegex = /(?:ROUTE|CITY|STATION)\s*[:\-]\s*([A-Za-z0-9\- ]+)/i;

  // Customer block header: e.g., "DEESA-01 SHREE GANESH TRADERS" or "PALANPUR-12 AMBICA COSMETICS"
  const customerHeaderRegex = /^([A-Z0-9\-]+)\s+(.+)$/;

  // Opening balance row: e.g., "Opening Balance: 15,400.00" or "OP. BAL 25000"
  const openingRegex = /(?:OPENING|OP\.?\s*BAL|OPENING\s*BALANCE)\s*[:\-]?\s*([0-9,]+(?:\.[0-9]{2})?)/i;

  // Bill row: DD/MM/YYYY followed by Bill No and Amount
  // e.g. "15/10/2026   INV-8894   12,450.00"
  const billRegex = /(\d{2}\/\d{2}\/\d{4})\s+([A-Za-z0-9\-_/]+)\s+([0-9,]+(?:\.[0-9]{2})?)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Locked Guardrail: Completely ignore "Order Pad" sections from parsing
    if (line.toUpperCase().includes('ORDER PAD')) {
      continue;
    }

    // 1. Detect City / Route Header
    const routeMatch = line.match(routeRegex);
    if (routeMatch && (!detectedCity || detectedCity === defaultCity)) {
      detectedCity = routeMatch[1].trim();
      continue;
    }

    // 2. Detect Customer Opening Balance
    const opMatch = line.match(openingRegex);
    if (opMatch && currentCustomerCode) {
      const entry = customersMap.get(currentCustomerCode);
      if (entry) {
        const opening = parseIndianNumber(opMatch[1]);
        entry.customer.opening = opening;
        entry.customer.balance = opening;
      }
      continue;
    }

    // 3. Detect Bill Rows
    const billMatch = line.match(billRegex);
    if (billMatch && currentCustomerCode) {
      const entry = customersMap.get(currentCustomerCode);
      if (entry) {
        const billAmt = parseIndianNumber(billMatch[3]);
        entry.bills.push({
          date: billMatch[1],
          no: billMatch[2],
          amount: billAmt
        });
        entry.customer.balance += billAmt;
      }
      continue;
    }

    // 4. Detect Customer Header (CITY-CODE NAME)
    // Avoid standard keywords that might look like customer headers
    if (!line.toUpperCase().startsWith('TOTAL') && !line.toUpperCase().startsWith('PAGE')) {
      const parts = line.split(/\s{2,}|\t/); // Split by multiple spaces or tabs
      if (parts.length >= 2) {
        const possibleCode = parts[0].trim();
        const possibleName = parts.slice(1).join(' ').trim();

        if (possibleCode.includes('-') && possibleName.length > 2) {
          currentCustomerCode = possibleCode;
          if (!customersMap.has(currentCustomerCode)) {
            customersMap.set(currentCustomerCode, {
              customer: {
                code: currentCustomerCode,
                name: possibleName,
                opening: 0,
                balance: 0
              },
              bills: []
            });
          }
          continue;
        }
      }

      // Single line fallback for customer code and name
      const singleLineMatch = line.match(customerHeaderRegex);
      if (singleLineMatch && singleLineMatch[1].includes('-')) {
        currentCustomerCode = singleLineMatch[1].trim();
        if (!customersMap.has(currentCustomerCode)) {
          customersMap.set(currentCustomerCode, {
            customer: {
              code: currentCustomerCode,
              name: singleLineMatch[2].trim(),
              opening: 0,
              balance: 0
            },
            bills: []
          });
        }
      }
    }
  }

  const customersList = Array.from(customersMap.values());
  const totalOpening = customersList.reduce((sum, item) => sum + item.customer.opening, 0);
  const totalBills = customersList.reduce(
    (sum, item) => sum + item.bills.reduce((bSum, b) => bSum + b.amount, 0),
    0
  );

  return {
    city: detectedCity || 'GENERAL',
    customers: customersList,
    totalOpening,
    totalBills
  };
}
