const assert = require('node:assert/strict');
const test = require('node:test');
const invoice = require('../lib/invoice');
const orders = require('../lib/orders');
const pricing = require('../lib/pricing');
const reports = require('../lib/reports');

function recordCheckout(items, coupon = '') {
  const checkout = pricing.computeTotals(items, coupon);
  const order = orders.add({ orders: [], nextOrderId: 1 }, {
    date: '15/06/2024',
    items,
    coupon,
    subtotal: checkout.subtotal,
    discount: checkout.discount,
    tax: checkout.tax,
    total: checkout.total
  });
  return { checkout, order };
}

test('an undiscounted 18% item has matching checkout and invoice figures', () => {
  const items = [{ id: 1, name: 'Tea', hsn: '0902', price: 10.50, qty: 2 }];
  const { order } = recordCheckout(items);
  const { rows, ...figures } = invoice.computeInvoiceFigures(order);

  assert.equal(order.total, 24.78);
  assert.equal(order.tax, 3.78);
  assert.deepEqual(figures, {
    subtotal: 21, discount: 0, tax: 3.78, cgst: 1.89, sgst: 1.89, total: 24.78
  });
  assert.equal(rows[0].gstPercent, 18);
  assert.equal(rows[0].lineTax, 3.78);
  assert.doesNotMatch(invoice.render(order), /Accountant Reconciliation Notice/);
});

test('invoice matches the billed total and GST for a discounted mixed-slab order', () => {
  const items = [
    { id: 1, name: 'Rice', hsn: '1006', price: 250, qty: 2 },
    { id: 2, name: 'Butter', hsn: '0405', price: 500, qty: 1 }
  ];
  const { order } = recordCheckout(items, 'SAVE10');
  const figures = invoice.computeInvoiceFigures(order);

  assert.deepEqual([order.total, order.tax, order.discount], [976.50, 76.50, 100]);
  assert.deepEqual([figures.total, figures.tax, figures.discount], [order.total, order.tax, order.discount]);
  assert.deepEqual(figures.rows.map(({ gstPercent, lineTax }) => [gstPercent, lineTax]), [
    [5, 22.50], [12, 54]
  ]);
});

test('invoice honours all three HSN slabs and the checkout coupon cap', () => {
  const items = [
    { id: 1, name: 'Rice', hsn: '1006', price: 500, qty: 2 },
    { id: 2, name: 'Butter', hsn: '0405', price: 600, qty: 1 },
    { id: 3, name: 'Tea', hsn: '0902', price: 400, qty: 1 }
  ];
  const { checkout, order } = recordCheckout(items, 'SAVE10');
  const { rows, ...figures } = invoice.computeInvoiceFigures(order);

  assert.equal(order.subtotal, 2000);
  assert.equal(order.discount, 150);
  assert.equal(order.tax, 179.45);
  assert.equal(order.total, 2029.45);
  assert.deepEqual([checkout.cgst, checkout.sgst], [89.73, 89.72]);
  assert.deepEqual(checkout.lines.map(({ gstPercent, taxable, tax }) => [gstPercent, taxable, tax]), [
    [5, 925, 46.25], [12, 555, 66.60], [18, 370, 66.60]
  ]);
  assert.deepEqual(figures, {
    subtotal: 2000, discount: 150, tax: 179.45, cgst: 89.73, sgst: 89.72, total: 2029.45
  });
  assert.deepEqual(rows.map(({ hsn, gstPercent, lineTax }) => [hsn, gstPercent, lineTax]), [
    ['1006', 5, 46.25], ['0405', 12, 66.60], ['0902', 18, 66.60]
  ]);

  const html = invoice.render(order);
  assert.match(html, /CGST \+ SGST \(Total GST\)<\/td><td[^>]*>₹179\.45<\/td>/);
  assert.match(html, /Invoice Total<\/td><td[^>]*>₹2029\.45<\/td>/);
  assert.doesNotMatch(html, /Accountant Reconciliation Notice/);

  assert.deepEqual(reports.getGstReconciliation({ orders: [order] }), {
    totalChecked: 1,
    mismatchCount: 0,
    totalDelta: 0,
    rows: [{
      orderId: 1, date: '15/06/2024', customer: 'Walk-in', coupon: 'SAVE10',
      ledgerSubtotal: 2000, ledgerDiscount: 150, ledgerTax: 179.45, ledgerTotal: 2029.45,
      invoiceDiscount: 150, invoiceTax: 179.45, invoiceTotal: 2029.45, delta: 0, matched: true
    }]
  });
});

test('a flat coupon reduces taxable value for both checkout and invoice GST', () => {
  const items = [{ id: 1, name: 'Tea', hsn: '0902', price: 400, qty: 1 }];
  const { checkout, order } = recordCheckout(items, 'FLAT50');
  const figures = invoice.computeInvoiceFigures(order);

  assert.equal(checkout.lines[0].taxable, 350);
  assert.deepEqual([order.discount, order.tax, order.total], [50, 63, 413]);
  assert.deepEqual([figures.discount, figures.tax, figures.total], [50, 63, 413]);
});

test('invoice follows checkout eligibility for an inactive coupon code', () => {
  const items = [{ id: 1, name: 'Tea', hsn: '0902', price: 1000, qty: 1 }];
  const figures = invoice.computeInvoiceFigures({ items, coupon: 'DIWALI20' });

  assert.deepEqual([figures.discount, figures.tax, figures.total], [0, 180, 1180]);
});

const gstCases = [
  { name: 'missing HSN and rate use the 18% fallback', fields: {}, expectedPercent: 18 },
  { name: 'a whole-percent rate overrides HSN', fields: { hsn: '0405', gstRate: 5 }, expectedPercent: 5 },
  { name: 'a decimal rate of 0.05 means 5% on the invoice', fields: { gstRate: 0.05 }, expectedPercent: 5 },
  { name: 'an explicit zero rate means 0% on the invoice', fields: { gstRate: 0 }, expectedPercent: 0 }
];

for (const { name, fields, expectedPercent } of gstCases) {
  test(name, () => {
    const items = [{ id: 1, name: 'Item', price: 100, qty: 1, ...fields }];
    const { order } = recordCheckout(items);
    const figures = invoice.computeInvoiceFigures(order);

    assert.equal(order.tax, expectedPercent);
    assert.equal(figures.tax, expectedPercent);
    assert.equal(figures.rows[0].gstPercent, expectedPercent);
  });
}

test('invoice GST sums the same rounded line amounts as checkout', () => {
  const items = [
    { id: 1, name: 'First item', hsn: '0902', price: 0.03, qty: 1 },
    { id: 2, name: 'Second item', hsn: '0902', price: 0.03, qty: 1 }
  ];
  const { checkout, order } = recordCheckout(items);
  const figures = invoice.computeInvoiceFigures(order);

  assert.deepEqual(figures.rows.map(({ lineTax }) => lineTax), [0.01, 0.01]);
  assert.deepEqual([checkout.tax, checkout.cgst, checkout.sgst, checkout.total], [0.02, 0.01, 0.01, 0.08]);
  assert.deepEqual([figures.tax, figures.cgst, figures.sgst, figures.total], [0.02, 0.01, 0.01, 0.08]);
  assert.doesNotMatch(invoice.render(order), /Accountant Reconciliation Notice/);
});

test('CURRENT BEHAVIOUR: a tax-only difference flags reconciliation but leaves the invoice banner hidden', () => {
  const items = [{ id: 1, name: 'Tea', hsn: '0902', price: 100, qty: 1 }];
  const { order } = recordCheckout(items);
  const recorded = { ...order, subtotal: 100.01, tax: 17.99 };
  const report = reports.getGstReconciliation({ orders: [recorded] });

  assert.equal(report.mismatchCount, 1);
  assert.equal(report.totalDelta, 0);
  assert.equal(report.rows[0].matched, false);
  assert.equal(report.rows[0].ledgerTax, 17.99);
  assert.equal(report.rows[0].invoiceTax, 18);
  assert.doesNotMatch(invoice.render(recorded), /Accountant Reconciliation Notice/);
});
