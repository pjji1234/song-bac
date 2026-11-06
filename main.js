// Sòng Bạc Tu Sĩ. Id phải trùng mod.yaml.
// Mọi kết quả may rủi chạy trong addAction với h.random(): tải lại save không đổi được kết quả.
const ID = 'song_bac';
const SONG_GOC = 'ev.song_bac_chieu_bac'; // sự kiện sòng bạc gốc

// ---------- Hằng ----------
const PHAM_TEN = ['', 'Phàm', 'Hoàng', 'Huyền', 'Địa', 'Thiên', 'Tiên', 'Thần', 'Nghịch Thiên'];
const PHAM_MAU = ['', '#8a8a80', '#a07d2a', '#3f7f6b', '#3a6fa8', '#8a3fa8', '#c0392b', '#b8860b', '#d4a017'];
// Đơn vị tiền theo cảnh giới 0..5 (Phàm Nhân tới Hóa Thần). Ước lượng, chỉnh bằng tùy chọn "thang_cuoc".
const DON_VI = [5, 40, 300, 2400, 19000, 150000];
const HAN_MUC_BOI = 20; // hạn mức vay = 20 đơn vị
const PHI_VAY = 0.05; // tiền nước: nhận ít hơn số ghi nợ
const HAN_NAM = 15; // quá chừng này năm kể từ khi còn nợ là quá hạn
const TI_LE_BAN = 0.5; // ước giá bán lại so với `gia` của vật, để định giá đá
const THU_NO_TOI_DA = 3; // mỗi nhịp đòi tối đa chừng này loại vật

// Năm bậc đá. Khóa = phẩm vật mài ra (0 = đá vụn, không ra gì). Giá trị = trọng số.
const BAC_THACH = [
  { ten: 'Phàm Thạch', mota: 'Đá thô ngoài rìa mỏ.', w: { 0: 38, 1: 44, 2: 15, 3: 2.7, 4: 0.3 } },
  { ten: 'Hoàng Thạch', mota: 'Lõi đá có vân vàng.', w: { 0: 34, 1: 24, 2: 30, 3: 9, 4: 2.6, 5: 0.4 } },
  { ten: 'Huyền Thạch', mota: 'Đá đen nặng tay, hơi lạnh.', w: { 0: 30, 1: 6, 2: 22, 3: 30, 4: 9, 5: 2.5, 6: 0.5 } },
  { ten: 'Địa Thạch', mota: 'Đá từ mạch sâu, linh khí ngầm.', w: { 0: 28, 2: 12, 3: 28, 4: 22, 5: 8, 6: 2 } },
  { ten: 'Thiên Thạch', mota: 'Đá rơi từ trời, vỏ khắc đầy trận văn.', w: { 0: 25, 3: 15, 4: 28, 5: 20, 6: 9, 7: 3 } },
];

// ---------- Tính toán thuần ----------
const dongNhat = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase();

const cacheSong = new Map();
/** Encounter có phải sòng bạc không: đúng id gốc, hoặc (phòng id đổi) tên có "sòng bạc" / lựa chọn có "cược ván". */
function laSongBac(content, id) {
  if (!id) return false;
  if (id === SONG_GOC) return true;
  if (cacheSong.has(id)) return cacheSong.get(id);
  const e = content.encounters.get(id);
  let ok = false;
  if (e) {
    ok = dongNhat(e.ten).includes('song bac') || (e.choices ?? []).some((c) => dongNhat(c.text).includes('cuoc van'));
  }
  cacheSong.set(id, ok);
  return ok;
}

const cachePool = new WeakMap();
/** Vật có thể mài ra: có phẩm 1..7, có giá, không phải trấn phái hay bất diệt. */
function layPool(content) {
  let p = cachePool.get(content);
  if (p) return p;
  const byPham = {};
  for (const it of content.items.values()) {
    const ph = it.pham_cap;
    if (!ph || ph < 1 || ph > 7 || !(it.gia > 0) || it.tran_phai || it.theo_kiep) continue;
    (byPham[ph] ??= []).push(it);
  }
  const avg = {};
  for (const k of Object.keys(byPham)) avg[k] = byPham[k].reduce((s, i) => s + i.gia, 0) / byPham[k].length;
  p = { byPham, avg };
  cachePool.set(content, p);
  return p;
}

/** Tỉ lệ ra từng phẩm và giá của bậc đá `i`. Phẩm không có vật nào thì bỏ, chia lại trọng số. */
function tinhBac(content, i, loiNha) {
  const { byPham, avg } = layPool(content);
  const w = BAC_THACH[i].w;
  const ds = Object.keys(w).map(Number).filter((ph) => ph === 0 || byPham[ph]);
  const tong = ds.reduce((s, ph) => s + w[ph], 0);
  let ev = 0;
  const odds = ds.map((ph) => {
    const p = w[ph] / tong;
    if (ph > 0) ev += p * avg[ph];
    return { ph, p };
  });
  const gia = Math.max(1, Math.round(ev * TI_LE_BAN * (1 + loiNha)));
  return { odds, gia };
}

const donVi = (nv, thang) => DON_VI[Math.min(Math.max(nv.canhGioi | 0, 0), 5)] * thang;
const hanMuc = (nv, thang) => Math.round(HAN_MUC_BOI * donVi(nv, thang));

const macDinh = () => ({ no: 0, tuoiNo: 0, n: 0, kq: null, ls: [], tk: { chi: 0, thu: 0, vat: 0, van: 0 } });
const docData = (raw) => ({ ...macDinh(), ...(raw ?? {}), tk: { ...macDinh().tk, ...(raw?.tk ?? {}) } });
const them = (d, e) => { d.ls = [...(d.ls ?? []), e].slice(-12); };

/** Vật người sòng sẽ thu khi quá hạn: không lấy đồ khóa / đang đeo, món đắt trước. */
function ungVienThu(nv, content) {
  const khoa = new Set([...(nv.lockedItems ?? []), ...Object.values(nv.trangBi ?? {})]);
  return Object.entries(nv.tuiDo ?? {})
    .filter(([id, c]) => c > 0 && !khoa.has(id))
    .map(([id, c]) => ({ id, c, ten: content.items.get(id)?.ten ?? id, v: (content.items.get(id)?.gia ?? 0) * TI_LE_BAN }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v);
}

/** Nợ sau k nhịp nữa (khớp với tick: lãi gấp đôi khi đã quá hạn, chưa tính bị thu). */
function duBao(no, tuoiNo, lai, k) {
  const out = [];
  for (let i = 0; i < k; i++) {
    const qh = tuoiNo > HAN_NAM;
    no = Math.ceil(no * (1 + lai * (qh ? 2 : 1)));
    tuoiNo += 5;
    out.push({ no, qh: tuoiNo > HAN_NAM });
  }
  return out;
}
const so = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

// ---------- Mod ----------
(window.tuTienMods ??= []).push({
  id: ID,

  boot(tt, mod) {
    const opt = () => ({
      loiNha: so(mod.options.loi_nha, 0.15),
      lai: so(mod.options.lai_suat, 0.15),
      thang: so(mod.options.thang_cuoc, 1),
      moiNoi: !!mod.options.moi_noi,
    });
    const core = () => tt.core;
    const loi = (msg) => new (core()['kernel/context'].LoiNguoiChoi)(msg);
    const ghi = (ctx, text) => core()['kernel/context'].log(ctx, text);
    const chonSong = (ctx) => {
      if (!opt().moiNoi && !laSongBac(ctx.content, ctx.run.active?.id)) throw loi('Phải đứng trong sòng bạc mới đánh được.');
    };
    const cho = (ctx, id, n) => {
      const t = core()['character/tui_do'];
      if (t?.nhanVaoTui) t.nhanVaoTui(ctx, id, n);
      else core()['index'].giveItem(ctx, id, n);
    };
    const lay = (ctx, id, n) => {
      const gi = core()['index']?.giveItem;
      const nv = ctx.run.nhanVat;
      if (gi) return gi(ctx, id, -n);
      nv.tuiDo[id] = (nv.tuiDo[id] ?? 0) - n;
      if (nv.tuiDo[id] <= 0) delete nv.tuiDo[id];
    };
    const soNguyen = (v) => (Number.isInteger(v) && v >= 1 ? v : null);

    // --- Đổ thạch ---
    mod.addAction('do_thach', (ctx, args, h) => {
      chonSong(ctx);
      const i = args?.bac;
      if (!Number.isInteger(i) || i < 0 || i >= BAC_THACH.length) throw loi('Không có loại đá đó.');
      const nv = ctx.run.nhanVat;
      const { odds, gia } = tinhBac(ctx.content, i, opt().loiNha);
      if (nv.linhThach < gia) throw loi(`Không đủ linh thạch (cần ${gia}).`);
      nv.linhThach -= gia;

      let r = h.random();
      let ph = odds[odds.length - 1].ph;
      for (const o of odds) {
        if (r < o.p) { ph = o.ph; break; }
        r -= o.p;
      }
      const d = docData(h.data());
      d.tk.chi += gia;
      d.tk.van += 1;
      let vat = null;
      if (ph > 0) {
        const arr = layPool(ctx.content).byPham[ph];
        const it = arr[Math.min(arr.length - 1, Math.floor(h.random() * arr.length))];
        cho(ctx, it.id, 1);
        d.tk.vat += 1;
        vat = { id: it.id, ten: it.ten, ph, gia: it.gia };
        ghi(ctx, `Đổ thạch: mua ${BAC_THACH[i].ten} giá ${gia}, mài ra ${it.ten} (phẩm ${PHAM_TEN[ph]}).`);
      } else {
        ghi(ctx, `Đổ thạch: mua ${BAC_THACH[i].ten} giá ${gia}, mài ra toàn đá vụn.`);
      }
      d.n += 1;
      d.kq = { loai: 'do', bac: i, gia, vat };
      them(d, { t: 'do', bac: i, ten: vat?.ten ?? null, ph: ph || 0 });
      h.setData(d);
      return 'khong_tick';
    });

    // --- Xúc xắc đại tiểu ---
    mod.addAction('xuc_xac', (ctx, args, h) => {
      chonSong(ctx);
      const cuoc = soNguyen(args?.so);
      if (!cuoc) throw loi('Tiền cược phải là số nguyên dương.');
      if (args?.huong !== 'dai' && args?.huong !== 'tieu') throw loi('Chưa chọn đại hay tiểu.');
      const nv = ctx.run.nhanVat;
      if (cuoc > nv.linhThach) throw loi('Không đủ linh thạch để cược.');
      const x = [0, 0, 0].map(() => 1 + Math.floor(h.random() * 6));
      const tong = x[0] + x[1] + x[2];
      const baBang = x[0] === x[1] && x[1] === x[2];
      const ra = tong >= 11 ? 'dai' : 'tieu';
      const thang = !baBang && ra === args.huong;
      nv.linhThach += thang ? cuoc : -cuoc;
      const d = docData(h.data());
      d.tk.van += 1;
      if (thang) d.tk.thu += cuoc; else d.tk.chi += cuoc;
      d.n += 1;
      d.kq = { loai: 'xx', x, tong, baBang, ra, huong: args.huong, cuoc, thang };
      them(d, { t: 'xx', ra: baBang ? 'ba' : ra, tong, thang });
      ghi(ctx, `Xúc xắc ${x.join('-')} (${tong}, ${baBang ? 'bộ ba, nhà cái ăn' : ra === 'dai' ? 'đại' : 'tiểu'}): đặt ${args.huong === 'dai' ? 'đại' : 'tiểu'} ${cuoc}, ${thang ? 'thắng' : 'thua'}.`);
      h.setData(d);
      return 'khong_tick';
    });

    // --- Vay / trả ---
    mod.addAction('vay', (ctx, args, h) => {
      chonSong(ctx);
      const n = soNguyen(args?.so);
      if (!n) throw loi('Số vay phải là số nguyên dương.');
      const nv = ctx.run.nhanVat;
      const d = docData(h.data());
      if (d.tuoiNo > HAN_NAM) throw loi('Nợ cũ đã quá hạn, sòng bạc không cho vay thêm.');
      const con = hanMuc(nv, opt().thang) - d.no;
      if (n > con) throw loi(`Vượt hạn mức vay (còn được vay ${Math.max(0, con)}).`);
      const nhan = Math.floor(n * (1 - PHI_VAY));
      nv.linhThach += nhan;
      if (d.no <= 0) d.tuoiNo = 0;
      d.no += n;
      d.n += 1;
      d.kq = { loai: 'vay', vay: n, nhan };
      ghi(ctx, `Vay sòng bạc ${n} linh thạch (trừ tiền nước, nhận ${nhan}). Nợ hiện ${d.no}.`);
      h.setData(d);
      return 'khong_tick';
    });

    mod.addAction('tra_no', (ctx, args, h) => {
      chonSong(ctx);
      const n = soNguyen(args?.so);
      if (!n) throw loi('Số trả phải là số nguyên dương.');
      const nv = ctx.run.nhanVat;
      const d = docData(h.data());
      if (d.no <= 0) throw loi('Ngươi không nợ gì.');
      const tra = Math.min(n, d.no);
      if (tra > nv.linhThach) throw loi('Không đủ linh thạch để trả.');
      nv.linhThach -= tra;
      d.no -= tra;
      if (d.no <= 0) d.tuoiNo = 0;
      d.n += 1;
      d.kq = { loai: 'tra', tra, con: d.no };
      ghi(ctx, `Trả sòng bạc ${tra} linh thạch. Nợ còn ${d.no}.`);
      h.setData(d);
      return 'khong_tick';
    });

    // --- Lãi chồng và đòi nợ mỗi nhịp thế giới ---
    mod.addTickHook((ctx, years, h) => {
      const d = docData(h.data());
      if (d.no <= 0) return;
      const nv = ctx.run.nhanVat;
      const quaHan = d.tuoiNo > HAN_NAM;
      const lai = opt().lai * (quaHan ? 2 : 1);
      d.no = Math.ceil(d.no * Math.pow(1 + lai, years / 5));
      d.tuoiNo += years;
      if (d.tuoiNo > HAN_NAM) {
        ghi(ctx, 'Nợ sòng bạc đã quá hạn, người của sòng tìm tới cửa.');
        const tra = Math.min(nv.linhThach, d.no);
        if (tra > 0) {
          nv.linhThach -= tra;
          d.no -= tra;
          ghi(ctx, `Họ lấy đi ${tra} linh thạch trừ nợ.`);
        }
        if (d.no > 0) {
          const ds = ungVienThu(nv, ctx.content).slice(0, THU_NO_TOI_DA);
          for (const x of ds) {
            if (d.no <= 0) break;
            const n = Math.min(x.c, Math.ceil(d.no / x.v));
            lay(ctx, x.id, n);
            d.no = Math.max(0, d.no - n * x.v);
            ghi(ctx, `Họ thu ${n} ${ctx.content.items.get(x.id)?.ten ?? x.id} gán nợ.`);
          }
          d.no = Math.ceil(d.no);
        }
      } else {
        ghi(ctx, `Nợ sòng bạc tính lãi, nay còn ${d.no} linh thạch.`);
      }
      if (d.no <= 0) { d.no = 0; d.tuoiNo = 0; }
      h.setData(d);
    });
  },

  ready(tt, mod) {
    const opt = () => ({
      loiNha: so(mod.options.loi_nha, 0.15),
      lai: so(mod.options.lai_suat, 0.15),
      thang: so(mod.options.thang_cuoc, 1),
      moiNoi: !!mod.options.moi_noi,
    });
    const dangOSong = () => laSongBac(tt.content, tt.state().run?.active?.id);
    let veSanh = null; // hàm đưa bàn cược về sảnh (đặt khi bàn cược đã dựng)

    // Vào sòng bạc (kể cả tải lại save đang đứng ở sòng) thì mở sảnh chọn trò.
    if (mod.options.tu_mo !== false) {
      const mo = () => { veSanh?.(); mod.ui.openPanel('ban_cuoc'); };
      tt.on('encounterStart', (e) => { if (laSongBac(tt.content, e.id)) mo(); });
      if (dangOSong()) setTimeout(mo, 300);
    }

    mod.ui.addPanel({
      id: 'ban_cuoc',
      title: 'Sòng Bạc Tu Sĩ',
      mount(el, tt2) {
        let view = 'menu'; // menu | do | xx | vay
        let bacChon = 0;
        let cuoc = 10;
        let huong = 'dai';
        let soVay = 50;
        let soTra = 50;
        let buocMai = null; // chữ hiện lúc đang mài đá
        let mat = null; // mặt xúc xắc hiện lúc đang lắc
        let loiTb = '';
        let timer = null;
        let song = true;

        const fmt = (n) => Math.round(n).toLocaleString('vi-VN');
        const E = (tag, a, ...kids) => {
          const n = document.createElement(tag);
          for (const [k, v] of Object.entries(a ?? {})) {
            if (v == null || v === false) continue;
            if (k === 'style') n.style.cssText = v;
            else if (k === 'class') n.className = v;
            else if (k.startsWith('on')) n[k] = v;
            else if (k === 'disabled') n.disabled = true;
            else n.setAttribute(k, v === true ? '' : v);
          }
          for (const c of kids.flat(Infinity)) if (c != null && c !== false) n.append(c.nodeType ? c : String(c));
          return n;
        };
        const dat = (node, ...kids) => node.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false).map((k) => (k.nodeType ? k : String(k))));
        const st = () => {
          const run = tt2.state().run;
          return { nv: run?.nhanVat, d: docData(run?.modData?.[ID]) };
        };
        const dangChay = () => !!buocMai || !!mat;
        const lam = (ten, args) => {
          try {
            tt2.game.modAction(ID, ten, args);
            loiTb = '';
            return true;
          } catch (e) {
            loiTb = e?.message ?? String(e);
            tt2.ui.toast(loiTb);
            draw();
            return false;
          }
        };
        const dung = () => { if (timer) { clearInterval(timer); timer = null; } };

        const css = E('style', {}, `
          .sb-note{font-size:calc(12px*var(--co-chu,1));color:var(--muc-nhat);margin-bottom:8px}
          .sb-head{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:4px 0 8px;margin-bottom:8px;border-bottom:1px solid var(--vien-trong);font-size:calc(13px*var(--co-chu,1))}
          .sb-card{display:flex;gap:10px;align-items:center;width:100%;text-align:left;padding:8px 10px;margin-bottom:8px;border:1px solid var(--vien-hud);background:transparent;cursor:pointer;color:var(--muc);font:inherit}
          .sb-card:hover{border-color:var(--chu-do)}
          .sb-ico{font-size:calc(26px*var(--co-chu,1));width:34px;text-align:center;flex:none}
          .sb-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
          .sb-box{border:1px solid var(--vien-hud);padding:8px 10px;margin-bottom:8px}
          .sb-stone{width:42px;height:42px;border-radius:50%;border:2px solid transparent;cursor:pointer;padding:0}
          .sb-stone.sel{border-color:var(--chu-do);box-shadow:0 0 0 2px var(--nen-hud)}
          .sb-bar{height:8px;background:var(--vien-trong);flex:1}
          .sb-bar>i{display:block;height:100%}
          .sb-oddrow{display:flex;gap:6px;align-items:center;font-size:calc(12px*var(--co-chu,1));margin-bottom:3px}
          .sb-oddrow>span:first-child{width:86px;flex:none}
          .sb-oddrow>span:last-child{width:96px;flex:none;text-align:right}
          .sb-zone{flex:1;padding:12px 6px;text-align:center;border:2px solid var(--vien-hud);background:transparent;color:var(--muc);cursor:pointer;font:inherit}
          .sb-zone.sel{border-color:var(--chu-do);background:var(--nen-hud);font-weight:bold}
          .sb-dice{font-size:calc(44px*var(--co-chu,1));text-align:center;letter-spacing:6px;line-height:1.1;padding:6px 0}
          .sb-chip{display:inline-block;min-width:22px;text-align:center;padding:1px 4px;margin-right:3px;border:1px solid var(--vien-hud);font-size:calc(11px*var(--co-chu,1))}
          .sb-bad{color:var(--chu-do)} .sb-good{color:var(--ngoc-luc)}
          .sb-tbl{width:100%;border-collapse:collapse;font-size:calc(12px*var(--co-chu,1))}
          .sb-tbl td{padding:2px 4px;border-bottom:1px solid var(--vien-trong)}
          .sb-in{width:110px}
        `);
        const head = E('div', { class: 'sb-head' });
        const body = E('div');
        el.append(css, head, body);

        // ---------- Đầu: tiền, nợ, nút về sảnh ----------
        function drawHead() {
          if (dangChay()) return; // đang mài / lắc: chưa lộ kết quả qua số dư
          const { nv, d } = st();
          if (!nv) return dat(head, 'Chưa có kiếp đang chơi.');
          dat(head,
            E('div', {}, 'Linh thạch ', E('b', {}, fmt(nv.linhThach)), '  ·  Nợ ', E('b', { class: d.no > 0 ? 'sb-bad' : '' }, fmt(d.no))),
            view !== 'menu' ? E('button', { class: 'nut-phu nut-nho', onclick: () => { dung(); buocMai = null; mat = null; view = 'menu'; draw(); } }, '← Về sảnh') : null);
        }

        // ---------- Sảnh ----------
        function sanh() {
          const { nv, d } = st();
          const card = (ico, ten, mota, phu, v) => E('button', { class: 'sb-card', onclick: () => { view = v; loiTb = ''; draw(); } },
            E('div', { class: 'sb-ico' }, ico),
            E('div', {}, E('b', {}, ten), E('div', { class: 'sb-note', style: 'margin:0' }, mota), phu));
          return [
            E('div', { class: 'sb-note' }, 'Đá, xúc xắc, chén cược trong sòng đều khắc trận ngăn thần thức: chỉ còn trông vào vận may. Chọn bàn muốn chơi.'),
            card('🪨', 'Đổ thạch', 'Mua đá, mài ra một vật bất kỳ. Đá càng đắt càng dễ ra phẩm cao.', null, 'do'),
            card('🎲', 'Xúc xắc đại tiểu', 'Cược tùy ý vào đại hoặc tiểu, ăn bằng tiền cược.', null, 'xx'),
            card('💰', 'Chủ sòng cho vay', 'Vay linh thạch để đánh tiếp. Lãi chồng, quá hạn bị đòi nợ.',
              E('div', { class: d.no > 0 ? 'sb-bad' : 'sb-note', style: 'margin:0' }, d.no > 0 ? `Đang nợ ${fmt(d.no)}` : `Hạn mức ${fmt(hanMuc(nv, opt().thang))}`), 'vay'),
            E('div', { class: 'sb-note' }, `Kiếp này: ${d.tk.van} ván, đã chi ${fmt(d.tk.chi)}, thắng xúc xắc ${fmt(d.tk.thu)}, mài ra ${d.tk.vat} vật.`),
          ];
        }

        // ---------- Bàn đổ thạch ----------
        const mauThach = (i) => `radial-gradient(circle at 32% 30%, #fff9, ${PHAM_MAU[i + 1]})`;
        function banDo() {
          const { nv, d } = st();
          const b = BAC_THACH[bacChon];
          const t = tinhBac(tt2.content, bacChon, opt().loiNha);
          const avg = layPool(tt2.content).avg;
          const ls = d.ls.filter((x) => x.t === 'do');
          const lsHien = (buocMai ? ls.slice(0, -1) : ls).slice(-5).reverse();
          const kq = d.kq?.loai === 'do' ? d.kq : null;
          const mai = () => {
            if (dangChay() || !lam('do_thach', { bac: bacChon })) return;
            const buoc = ['Cắt lớp vỏ đá…', 'Mài tới lõi…', 'Ánh linh quang lóe lên…'];
            let i = 0;
            buocMai = buoc[0];
            draw();
            timer = setInterval(() => {
              i += 1;
              if (i >= buoc.length) { dung(); buocMai = null; draw(); } else { buocMai = buoc[i]; draw(); }
            }, 450);
          };
          return [
            E('div', { class: 'sb-row', style: 'justify-content:space-between' }, BAC_THACH.map((x, i) =>
              E('div', { style: 'text-align:center' },
                E('button', { class: 'sb-stone' + (i === bacChon ? ' sel' : ''), title: x.ten, style: `background:${mauThach(i)}`, disabled: dangChay(), onclick: () => { bacChon = i; draw(); } }),
                E('div', { class: 'sb-note', style: 'margin:2px 0 0' }, x.ten.split(' ')[0])))),
            E('div', { class: 'sb-box' },
              E('div', {}, E('b', {}, b.ten), E('span', { class: 'sb-note' }, '  ' + b.mota)),
              E('div', { style: 'margin:6px 0 4px' }, 'Tỉ lệ ra:'),
              t.odds.map((o) => E('div', { class: 'sb-oddrow' },
                E('span', { style: o.ph ? `color:${PHAM_MAU[o.ph]}` : '' }, o.ph ? `Phẩm ${PHAM_TEN[o.ph]}` : 'Đá vụn'),
                E('div', { class: 'sb-bar' }, E('i', { style: `width:${Math.max(2, o.p * 100)}%;background:${o.ph ? PHAM_MAU[o.ph] : 'var(--xam-nhat)'}` })),
                E('span', {}, (o.p * 100).toFixed(o.p < 0.1 ? 1 : 0) + '%', o.ph && avg[o.ph] ? E('span', { class: 'sb-note' }, ` · ~${fmt(avg[o.ph])}`) : ''))),
              E('div', { class: 'sb-note', style: 'margin-top:4px' }, 'Số sau dấu · là giá gốc trung bình của vật phẩm đó.')),
            E('button', { class: 'nut-chinh', style: 'width:100%;margin-bottom:8px', disabled: dangChay() || nv.linhThach < t.gia, onclick: mai }, `Mua và mài ${b.ten} (${fmt(t.gia)} linh thạch)`),
            E('div', { class: 'sb-box', style: 'min-height:44px' },
              buocMai ? E('div', {}, buocMai)
                : kq ? E('div', {}, `${BAC_THACH[kq.bac].ten} (giá ${fmt(kq.gia)}): `, kq.vat
                  ? E('span', {}, 'mài ra ', E('b', { style: `color:${PHAM_MAU[kq.vat.ph]}` }, kq.vat.ten), ` (phẩm ${PHAM_TEN[kq.vat.ph]}, giá gốc ${fmt(kq.vat.gia)}), đã bỏ vào túi.`)
                  : E('span', { class: 'sb-note' }, 'toàn đá vụn.'))
                  : E('div', { class: 'sb-note' }, 'Chọn một viên đá rồi mài.')),
            lsHien.length ? E('div', { class: 'sb-note' }, 'Gần đây: ', lsHien.map((x) => E('span', { class: 'sb-chip', style: x.ph ? `color:${PHAM_MAU[x.ph]}` : '' }, x.ph ? x.ten : 'vụn'))) : null,
          ];
        }

        // ---------- Bàn xúc xắc ----------
        const MAT = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
        function banXX() {
          const { nv, d } = st();
          const kq = d.kq?.loai === 'xx' ? d.kq : null;
          const ls = d.ls.filter((x) => x.t === 'xx');
          const lsHien = (mat ? ls.slice(0, -1) : ls).slice(-12);
          const dat_cuoc = (v) => { cuoc = Math.max(1, Math.floor(v)); draw(); };
          const lac = () => {
            if (dangChay() || !lam('xuc_xac', { huong, so: cuoc })) return;
            let i = 0;
            const ngau = () => [0, 1, 2].map(() => Math.floor(Math.random() * 6));
            mat = ngau();
            draw();
            timer = setInterval(() => {
              i += 1;
              if (i >= 9) { dung(); mat = null; draw(); } else { mat = ngau(); draw(); }
            }, 80);
          };
          const hien = mat ? mat.map((v) => MAT[v]).join(' ') : kq ? kq.x.map((v) => MAT[v - 1]).join(' ') : '⚀ ⚀ ⚀';
          return [
            E('div', { class: 'sb-note' }, 'Tiểu: tổng 3-10. Đại: tổng 11-18. Thắng ăn 1:1. Ra bộ ba (ba mặt giống nhau, 2,8%) thì nhà cái ăn cả hai cửa.'),
            E('div', { class: 'sb-row' },
              E('button', { class: 'sb-zone' + (huong === 'tieu' ? ' sel' : ''), disabled: dangChay(), onclick: () => { huong = 'tieu'; draw(); } }, 'TIỂU', E('div', { class: 'sb-note', style: 'margin:0' }, '3 - 10')),
              E('button', { class: 'sb-zone' + (huong === 'dai' ? ' sel' : ''), disabled: dangChay(), onclick: () => { huong = 'dai'; draw(); } }, 'ĐẠI', E('div', { class: 'sb-note', style: 'margin:0' }, '11 - 18'))),
            E('div', { class: 'sb-box' }, E('div', { class: 'sb-dice' }, hien),
              mat ? E('div', { class: 'sb-note', style: 'text-align:center' }, 'Đang lắc…')
                : kq ? E('div', { style: 'text-align:center' }, `Tổng ${kq.tong}: ${kq.baBang ? 'bộ ba, nhà cái ăn' : kq.ra === 'dai' ? 'đại' : 'tiểu'}. `,
                  E('b', { class: kq.thang ? 'sb-good' : 'sb-bad' }, kq.thang ? `Thắng +${fmt(kq.cuoc)}` : `Thua -${fmt(kq.cuoc)}`))
                  : E('div', { class: 'sb-note', style: 'text-align:center' }, 'Đặt cửa, đặt tiền rồi lắc.')),
            E('div', { class: 'sb-row' }, 'Tiền cược:',
              E('input', { class: 'sb-in', type: 'number', min: '1', value: String(cuoc), disabled: dangChay(), oninput: (e) => { cuoc = Math.floor(+e.target.value) || 0; } }),
              E('button', { class: 'nut-phu nut-nho', disabled: dangChay(), onclick: () => dat_cuoc(cuoc / 2) }, '½'),
              E('button', { class: 'nut-phu nut-nho', disabled: dangChay(), onclick: () => dat_cuoc(cuoc * 2) }, '×2')),
            E('div', { class: 'sb-row' }, [['5%', 0.05], ['10%', 0.1], ['25%', 0.25], ['50%', 0.5], ['Tất cả', 1]].map(([ten, f]) =>
              E('button', { class: 'nut-phu nut-nho', disabled: dangChay(), onclick: () => dat_cuoc(nv.linhThach * f) }, ten))),
            E('button', { class: 'nut-chinh', style: 'width:100%;margin-bottom:8px', disabled: dangChay() || cuoc < 1 || cuoc > nv.linhThach, onclick: lac },
              `Lắc, cược ${fmt(cuoc)} vào ${huong === 'dai' ? 'ĐẠI' : 'TIỂU'}`),
            lsHien.length ? E('div', { class: 'sb-note' }, 'Các ván trước: ', lsHien.map((x) => E('span', { class: 'sb-chip ' + (x.thang ? 'sb-good' : 'sb-bad'), title: `tổng ${x.tong}` }, x.ra === 'ba' ? '3' : x.ra === 'dai' ? 'Đ' : 'T'))) : null,
          ];
        }

        // ---------- Bàn vay nợ ----------
        function banVay() {
          const { nv, d } = st();
          const o = opt();
          const lim = hanMuc(nv, o.thang);
          const con = Math.max(0, lim - d.no);
          const quaHan = d.tuoiNo > HAN_NAM;
          const kq = d.kq && (d.kq.loai === 'vay' || d.kq.loai === 'tra') ? d.kq : null;
          const db = d.no > 0 ? duBao(d.no, d.tuoiNo, o.lai, 3) : [];
          const bi = d.no > 0 ? ungVienThu(nv, tt2.content).slice(0, THU_NO_TOI_DA) : [];
          const chip = (ten, f, set, max) => E('button', { class: 'nut-phu nut-nho', onclick: () => { set(Math.max(1, Math.floor(max * f))); draw(); } }, ten);
          return [
            E('div', { class: 'sb-note' }, `Cho vay nặng lãi: mỗi nhịp 5 năm nợ nhân thêm ${Math.round(o.lai * 100)}%, quá ${HAN_NAM} năm thì gấp đôi. Trừ ${Math.round(PHI_VAY * 100)}% tiền nước ngay khi nhận.`),
            E('div', { class: 'sb-box' },
              E('div', {}, 'Đang nợ: ', E('b', { class: d.no > 0 ? 'sb-bad' : '' }, fmt(d.no)), `  ·  Hạn mức: ${fmt(lim)}  ·  Còn vay được: ${fmt(con)}`),
              d.no > 0 ? E('div', { class: 'sb-note', style: 'margin-top:4px' }, `Đã nợ ${d.tuoiNo}/${HAN_NAM} năm`,
                E('div', { class: 'sb-bar', style: 'margin-top:3px' }, E('i', { style: `width:${Math.min(100, (d.tuoiNo / HAN_NAM) * 100)}%;background:${quaHan ? 'var(--chu-do)' : 'var(--vang-kim)'}` }))) : null,
              quaHan ? E('div', { class: 'sb-bad', style: 'margin-top:4px' }, 'Nợ quá hạn: không vay thêm được, lãi gấp đôi, nhịp tới người sòng tới đòi.') : null),
            db.length ? E('div', { class: 'sb-box' }, E('div', { class: 'sb-note' }, 'Nếu để đó, nợ sẽ thành:'),
              E('table', { class: 'sb-tbl' }, db.map((x, i) => E('tr', {}, E('td', {}, `Sau ${(i + 1) * 5} năm`), E('td', { class: x.qh ? 'sb-bad' : '' }, fmt(x.no)), E('td', { class: 'sb-note' }, x.qh ? 'quá hạn' : ''))))) : null,
            bi.length && quaHan ? E('div', { class: 'sb-box' }, E('div', { class: 'sb-note' }, 'Khi quá hạn sẽ bị thu (sau linh thạch): '), bi.map((x) => E('div', { class: 'sb-bad' }, `${x.ten} ×${x.c}`)),
              E('div', { class: 'sb-note' }, 'Khóa vật quan trọng trong túi để khỏi bị thu.')) : null,
            E('div', { class: 'sb-box' }, E('b', {}, 'Vay'),
              E('div', { class: 'sb-row', style: 'margin-top:4px' },
                E('input', { class: 'sb-in', type: 'number', min: '1', value: String(soVay), oninput: (e) => { soVay = Math.floor(+e.target.value) || 0; } }),
                chip('¼', 0.25, (v) => { soVay = v; }, con), chip('½', 0.5, (v) => { soVay = v; }, con), chip('Tối đa', 1, (v) => { soVay = v; }, con)),
              E('div', { class: 'sb-note' }, soVay > 0 ? `Nhận ${fmt(Math.floor(soVay * (1 - PHI_VAY)))}, ghi nợ ${fmt(soVay)}.` : ''),
              E('button', { class: 'nut-chinh', disabled: quaHan || soVay < 1 || soVay > con, onclick: () => { if (lam('vay', { so: soVay })) draw(); } }, 'Vay')),
            E('div', { class: 'sb-box' }, E('b', {}, 'Trả nợ'),
              E('div', { class: 'sb-row', style: 'margin-top:4px' },
                E('input', { class: 'sb-in', type: 'number', min: '1', value: String(soTra), oninput: (e) => { soTra = Math.floor(+e.target.value) || 0; } }),
                chip('¼', 0.25, (v) => { soTra = v; }, d.no), chip('½', 0.5, (v) => { soTra = v; }, d.no), chip('Hết', 1, (v) => { soTra = v; }, d.no)),
              E('div', { class: 'sb-row' },
                E('button', { class: 'nut-phu', disabled: d.no <= 0 || soTra < 1 || Math.min(soTra, d.no) > nv.linhThach, onclick: () => { if (lam('tra_no', { so: Math.min(soTra, d.no) })) draw(); } }, 'Trả'),
                E('button', { class: 'nut-phu', disabled: d.no <= 0 || d.no > nv.linhThach, onclick: () => { if (lam('tra_no', { so: d.no })) draw(); } }, `Trả hết (${fmt(d.no)})`))),
            kq ? E('div', { class: 'sb-note' }, kq.loai === 'vay' ? `Vừa vay ${fmt(kq.vay)}, trừ tiền nước nhận ${fmt(kq.nhan)}.` : `Vừa trả ${fmt(kq.tra)}, nợ còn ${fmt(kq.con)}.`) : null,
          ];
        }

        // ---------- Dựng ----------
        function draw() {
          drawHead();
          const { nv } = st();
          if (!nv) return dat(body);
          song = opt().moiNoi || dangOSong();
          if (!song) return dat(body, E('div', { style: 'padding:10px 0' }, 'Ngươi không đứng trong sòng bạc. Tới một sòng bạc rồi mở lại bàn cược.'));
          dat(body,
            loiTb ? E('div', { class: 'sb-bad', style: 'margin-bottom:6px' }, loiTb) : null,
            view === 'do' ? banDo() : view === 'xx' ? banXX() : view === 'vay' ? banVay() : sanh());
        }

        veSanh = () => { dung(); buocMai = null; mat = null; loiTb = ''; view = 'menu'; if (el.isConnected) draw(); };
        draw();
        const huy = tt2.subscribe(() => {
          drawHead();
          if ((opt().moiNoi || dangOSong()) !== song && !dangChay()) draw();
        });
        return () => { huy(); dung(); veSanh = null; };
      },
    });
  },
});
