import { supabase, configured } from './supabase-client.js';
import { getCart, setCart } from './cart.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const paras = t => String(t ?? '').split(/\n{2,}/).filter(p => p.trim()).map(p => `<p>${esc(p.trim())}</p>`).join('');
let cur = 'USD';
const money = (n, c = cur) => new Intl.NumberFormat(undefined, { style: 'currency', currency: c }).format(n);
const LABEL = { pending_review: 'Awaiting review', approved: 'Approved: payment due', rejected: 'Not approved', paid: 'Paid', fulfilled: 'Completed', cancelled: 'Cancelled', unpaid: 'Unpaid', pending: 'Payment pending', refunded: 'Refunded' };
const RANK = { ship: 0, licensed_transfer: 1, pickup_only: 2 };
const getSession = async () => (await supabase.auth.getSession()).data.session;
const setting = async keys => Object.fromEntries(((await supabase.from('site_settings').select('setting_key,setting_value').in('setting_key', keys)).data || []).map(r => [r.setting_key, r.setting_value]));
const bad = (el, m) => { el.className = 'notice'; el.textContent = m; };
const safe = e => (e?.code === 'P0001' ? e.message : 'Something went wrong. Please try again.');
const EMPTY = '<p>Your cart is empty. <a href="shop.html">Browse the shop</a>.</p>';

async function cartPage(el) {
  let cart = getCart();
  const { data } = cart.length ? await supabase.from('products').select('id,name,slug,price,stock_status').in('id', cart.map(i => i.id)).eq('status', 'published') : { data: [] };
  const P = Object.fromEntries((data || []).map(p => [p.id, p]));
  cart = cart.filter(i => P[i.id]); setCart(cart);
  const gone = p => p.price == null || p.stock_status === 'out_of_stock';
  const draw = () => {
    if (!cart.length) { el.innerHTML = EMPTY; return; }
    const sub = cart.reduce((s, i) => s + (P[i.id].price ?? 0) * i.qty, 0);
    el.innerHTML = `<table class="tbl"><thead><tr><th>Item</th><th>Price</th><th>Quantity</th><th></th></tr></thead><tbody>${cart.map(i => { const p = P[i.id]; return `<tr><td><a href="product.html?slug=${encodeURIComponent(p.slug)}">${esc(p.name)}</a>${gone(p) ? ' <span class="stock out">Unavailable</span>' : ''}</td><td>${p.price == null ? 'n/a' : money(p.price)}</td><td><select data-qty="${esc(i.id)}" aria-label="Quantity" style="width:auto">${[...Array(10)].map((_, n) => `<option ${n + 1 === i.qty ? 'selected' : ''}>${n + 1}</option>`).join('')}</select></td><td><button class="btn sec" data-rm="${esc(i.id)}">Remove</button></td></tr>`; }).join('')}</tbody></table><p class="price">Subtotal: ${money(sub)}</p><p class="muted">Delivery is chosen at checkout. Prices and availability are checked again when you place your order.</p>${cart.some(i => gone(P[i.id])) ? '<p class="notice">Remove unavailable items to continue.</p>' : '<a class="btn dark" href="checkout.html">Checkout</a>'}`;
  };
  el.onchange = e => { const id = e.target.dataset.qty; if (!id) return; cart.find(i => i.id === id).qty = Number(e.target.value); setCart(cart); draw(); };
  el.onclick = e => { const id = e.target.dataset.rm; if (!id) return; cart = cart.filter(i => i.id !== id); setCart(cart); draw(); };
  draw();
}

async function checkoutPage(el) {
  const s = await getSession();
  if (!s) { el.innerHTML = '<p>Please <a href="account.html?next=checkout.html">sign in or create an account</a> to check out.</p>'; return; }
  const cart = getCart();
  if (!cart.length) { el.innerHTML = EMPTY; return; }
  const [{ data: prods }, { data: ms }, { data: prof }] = await Promise.all([
    supabase.from('products').select('id,name,price,stock_status,fulfilment').in('id', cart.map(i => i.id)).eq('status', 'published'),
    supabase.from('shipping_methods').select('id,name,description,method_type,price').eq('status', 'published').order('display_order'),
    supabase.from('profiles').select('full_name,phone,address_line1,city,region,postal_code,country').eq('id', s.user.id).maybeSingle(),
  ]);
  const P = Object.fromEntries((prods || []).map(p => [p.id, p]));
  if (cart.some(i => !P[i.id] || P[i.id].price == null || P[i.id].stock_status === 'out_of_stock')) { el.innerHTML = '<p class="notice">Some items are unavailable. <a href="cart.html">Review your cart</a>.</p>'; return; }
  const need = Math.max(...cart.map(i => RANK[P[i.id].fulfilment]));
  const ok = (ms || []).filter(m => need === 0 || (need === 1 && m.method_type !== 'ship') || (need === 2 && m.method_type === 'pickup'));
  if (!ok.length) { el.innerHTML = '<p class="notice">No delivery method is available for the items in your cart yet. <a href="contact.html">Contact us</a>.</p>'; return; }
  const sub = cart.reduce((t, i) => t + P[i.id].price * i.qty, 0), pr = prof || {};
  el.innerHTML = `<div class="pd"><form id="co" class="card" novalidate><h2>Your details</h2>
<label for="c_name">Full name</label><input id="c_name" name="name" autocomplete="name" required maxlength="100" value="${esc(pr.full_name)}">
<label for="c_phone">Phone</label><input id="c_phone" name="phone" type="tel" autocomplete="tel" maxlength="30" value="${esc(pr.phone)}">
<h2 style="margin-top:20px">Delivery</h2>${ok.map((m, i) => `<label class="chk"><input type="radio" name="method" value="${esc(m.id)}" ${i ? '' : 'checked'}><span><b>${esc(m.name)}</b> (${money(m.price)})<br><span class="muted">${esc(m.description)}</span></span></label>`).join('')}
<div id="ship-box" hidden><label for="c_ship">Delivery address</label><textarea id="c_ship" name="ship_to" rows="4" maxlength="400">${esc([pr.address_line1, pr.city, pr.region, pr.postal_code, pr.country].filter(Boolean).join('\n'))}</textarea></div>
<div id="dealer-box" hidden><label for="c_dealer">Receiving licensed dealer (name, address, licence reference)</label><textarea id="c_dealer" name="dealer" rows="4" maxlength="400"></textarea><p class="muted">Staff verify the dealer before anything is released.</p></div>
<h2 style="margin-top:20px">Payment</h2><label for="c_pay">Payment method</label><select id="c_pay" name="payment"><option value="pay_on_collection">Pay on collection or transfer</option><option value="bank_transfer">Bank transfer</option><option value="payment_link">Secure payment link sent by email</option></select>
<p class="muted">No payment is taken now. We review your order first, then tell you how to pay.</p>
<label for="c_notes">Notes (optional)</label><textarea id="c_notes" name="notes" rows="3" maxlength="1000"></textarea>
<label class="chk"><input type="checkbox" name="ack"> I am of legal age and eligible to buy these items where I live, and I understand my order is reviewed and may be declined.</label>
<button class="btn dark" type="submit">Place order</button><p id="co-status" role="status"></p></form>
<div class="card"><h2>Order summary</h2><ul>${cart.map(i => `<li>${esc(P[i.id].name)} x ${i.qty}: ${money(P[i.id].price * i.qty)}</li>`).join('')}</ul><p>Items: ${money(sub)}</p><p class="price" id="tot"></p></div></div>`;
  const f = $('#co'), st = $('#co-status');
  const pick = () => ok.find(m => m.id === f.elements.method.value);
  const sync = () => { const m = pick(); $('#ship-box').hidden = m?.method_type !== 'ship'; $('#dealer-box').hidden = m?.method_type !== 'licensed_transfer'; $('#tot').textContent = `Total: ${money(sub + Number(m?.price ?? 0))}`; };
  f.addEventListener('change', sync); sync();
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f)), m = pick();
    if (!m) return bad(st, 'Choose a delivery method.');
    if ((d.name || '').trim().length < 2) return bad(st, 'Enter your name.');
    if (m.method_type === 'ship' && (d.ship_to || '').trim().length < 10) return bad(st, 'Enter a delivery address.');
    if (m.method_type === 'licensed_transfer' && (d.dealer || '').trim().length < 10) return bad(st, 'Enter the receiving dealer details.');
    if (!d.ack) return bad(st, 'Please confirm the eligibility statement.');
    const btn = $('button[type=submit]', f); btn.disabled = true; st.className = ''; st.textContent = 'Placing your order…';
    const { data: oid, error } = await supabase.rpc('place_order', { p_items: cart.map(i => ({ id: i.id, qty: i.qty })), p_method: m.id, p_payment: d.payment, p_details: { name: d.name, phone: d.phone, ship_to: d.ship_to, dealer: d.dealer, notes: d.notes, ack: 'true' } });
    btn.disabled = false;
    if (error) return bad(st, safe(error));
    setCart([]);
    const { data: o } = await supabase.from('orders').select('order_number').eq('id', oid).maybeSingle();
    el.innerHTML = `<h2>Order ${o ? '#' + esc(o.order_number) + ' ' : ''}received</h2><p>Your order is awaiting review. We will confirm eligibility with you before any payment is taken, and then tell you how to pay.</p><p><a class="btn dark" href="account.html">View my orders</a></p>`;
  });
}

async function accountPage(el) {
  const s = await getSession();
  const next = (/^[a-z-]+\.html$/.exec(new URLSearchParams(location.search).get('next') || '') || ['account.html'])[0];
  if (!s) {
    el.innerHTML = `<div class="grid"><form id="in" class="card" novalidate><h2>Sign in</h2><label for="i_email">Email</label><input id="i_email" name="email" type="email" autocomplete="username" required><label for="i_pw">Password</label><input id="i_pw" name="password" type="password" autocomplete="current-password" required><p><button class="btn dark" type="submit">Sign in</button></p></form>
<form id="up" class="card" novalidate><h2>Create account</h2><label for="u_email">Email</label><input id="u_email" name="email" type="email" autocomplete="email" required><label for="u_pw">Password (at least 10 characters)</label><input id="u_pw" name="password" type="password" autocomplete="new-password" required minlength="10"><p><button class="btn dark" type="submit">Create account</button></p></form></div><p id="auth-status" role="status"></p>`;
    const st = $('#auth-status');
    $('#in').onsubmit = async e => {
      e.preventDefault(); const f = e.target.elements; st.className = ''; st.textContent = 'Signing in…';
      const { error } = await supabase.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
      if (error) bad(st, 'Sign-in failed. Check your email and password.'); else location.href = next;
    };
    $('#up').onsubmit = async e => {
      e.preventDefault(); const f = e.target.elements;
      if (f.password.value.length < 10) return bad(st, 'Use a password of at least 10 characters.');
      st.className = ''; st.textContent = 'Creating your account…';
      const { data, error } = await supabase.auth.signUp({ email: f.email.value.trim(), password: f.password.value, options: { emailRedirectTo: new URL('account.html', location.href).href } });
      if (error) return bad(st, 'Could not create the account. Check your details and try again.');
      if (data.session) location.href = next; else { st.className = 'notice ok'; st.textContent = 'Check your email to confirm your account, then sign in.'; }
    };
    return;
  }
  const [{ data: pr }, { data: os }, S] = await Promise.all([
    supabase.from('profiles').select('full_name,phone,address_line1,city,region,postal_code,country').eq('id', s.user.id).maybeSingle(),
    supabase.from('orders').select('order_number,status,payment_status,payment_method,total,currency,created_at,tracking_number,order_items(product_name,quantity)').order('created_at', { ascending: false }),
    setting(['payment_instructions']),
  ]);
  const f = pr || {}, F = ['full_name', 'phone', 'address_line1', 'city', 'region', 'postal_code', 'country'];
  const help = o => ({ pay_on_collection: '<p>Pay when you collect or take transfer of your order.</p>', bank_transfer: S.payment_instructions ? paras(S.payment_instructions) : '<p>We will send you our bank details.</p>', payment_link: '<p>We will email you a secure payment link.</p>' }[o.payment_method]);
  el.innerHTML = `<p class="row"><span>Signed in as <b>${esc(s.user.email)}</b></span><button id="out" class="btn sec" type="button">Sign out</button></p>
<h2>My orders</h2>${os?.length ? os.map(o => `<article class="card" style="margin-bottom:12px"><h3>Order #${esc(o.order_number)}</h3><p class="muted">${new Date(o.created_at).toLocaleDateString()}</p><p><span class="badge">${LABEL[o.status]}</span> <span class="badge">${LABEL[o.payment_status]}</span></p><ul>${o.order_items.map(i => `<li>${esc(i.product_name)} x ${i.quantity}</li>`).join('')}</ul><p class="price">${money(o.total, o.currency)}</p>${o.tracking_number ? `<p>Tracking: ${esc(o.tracking_number)}</p>` : ''}${o.status === 'approved' && o.payment_status === 'unpaid' ? help(o) : ''}</article>`).join('') : '<p class="muted">No orders yet.</p>'}
<h2>My details</h2><form id="prof" class="card">${F.map(n => `<label for="p_${n}">${n.replace(/_/g, ' ')}</label><input id="p_${n}" name="${n}" value="${esc(f[n])}" maxlength="150">`).join('')}<p><button class="btn dark" type="submit">Save details</button></p><p id="prof-status" role="status"></p></form>`;
  $('#out').onclick = async () => { await supabase.auth.signOut(); location.reload(); };
  $('#prof').onsubmit = async e => {
    e.preventDefault(); const out = {}; F.forEach(n => (out[n] = e.target.elements[n].value.trim() || null));
    const { error } = await supabase.from('profiles').update(out).eq('id', s.user.id), st = $('#prof-status');
    if (error) bad(st, 'Could not save your details.'); else { st.className = 'notice ok'; st.textContent = 'Details saved.'; }
  };
}

async function init() {
  const roots = [...document.querySelectorAll('[data-commerce]')]; if (!roots.length) return;
  if (!configured) { roots.forEach(el => (el.innerHTML = '<p class="notice">Supabase is not configured (see README).</p>')); return; }
  const { data: s } = await supabase.from('site_settings').select('setting_value').eq('setting_key', 'currency_code').maybeSingle();
  if (/^[A-Za-z]{3}$/.test(s?.setting_value || '')) cur = s.setting_value.toUpperCase();
  await Promise.all(roots.map(el => ({ cart: cartPage, checkout: checkoutPage, account: accountPage }[el.dataset.commerce])(el)));
}
init();
