window.__ModuleLoader__.load({
  id: 'dsh-sidebar-account-usage',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'sidebar.accountUsage';
    const ROUTE = '/plugins/sidebar-account-usage/snapshot';
    const POLL_MS = 60_000;

    const en = {
      balance: 'Balance',
      today: 'Today',
      signedOut: 'Not signed in to DeepSeek',
      updated: 'Updated',
      unavailable: 'Balance unavailable — click to retry',
      spendUnavailable: "Today's spend is unavailable",
      peak: 'Peak',
      offPeak: 'Off-peak',
      nextChange: 'next',
      peakRule: 'Peak hours: Beijing time, Mon–Fri 09:00–12:00 and 14:00–18:00. All other times, including weekends and public holidays, are off-peak at half price.',
    };

    const zh = {
      balance: '余额',
      today: '今日',
      signedOut: '未登录 DeepSeek 账户',
      updated: '更新于',
      unavailable: '余额暂不可用，点击重试',
      spendUnavailable: '今日消耗暂时不可用',
      peak: '高峰',
      offPeak: '空闲 5 折',
      nextChange: '下次切换',
      peakRule: '高峰时段：北京时间周一至周五 09:00–12:00、14:00–18:00；其余时段（含周末及中国法定节假日全天）为空闲时段，价格为高峰的 50%。',
    };

    /** @param currency - ISO currency code. */
    function symbolOf(currency) {
      if (currency === 'CNY') return '¥';
      if (currency === 'USD') return '$';
      return `${currency} `;
    }

    /**
     * Build the sidebar pill component bound to this plugin's context.
     * @param ctx - Client plugin context.
     */
    function createPill(ctx) {
      const translate = ctx.locale.bind(NS);
      const t = (key) => {
        try {
          const value = translate(key);
          return typeof value === 'string' ? value : key;
        } catch {
          return key;
        }
      };

      const localeId = () => {
        try {
          return ctx.locale.getSnapshot().active || 'en';
        } catch {
          return 'en';
        }
      };

      const formatAmount = (value) => {
        if (!Number.isFinite(value)) return '—';
        if (value > 0 && value < 0.01) return '<0.01';
        try {
          return new Intl.NumberFormat(localeId(), {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }).format(value);
        } catch {
          return value.toFixed(2);
        }
      };

      const pickPrimary = (list) => {
        if (!Array.isArray(list) || list.length === 0) return null;
        return list.find((wallet) => Number(wallet.amount) > 0) ?? list[0];
      };

      const requestSnapshot = async (signal) => {
        const now = new Date();
        const start = new Date(now);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        const params = new URLSearchParams();
        params.set('start', String(Math.floor(start.getTime() / 1000)));
        params.set('end', String(Math.floor(end.getTime() / 1000)));
        params.set('tz', String(-now.getTimezoneOffset() * 60));
        params.set('locale', localeId());
        const response = await fetch(`${ROUTE}?${params.toString()}`, {
          headers: { accept: 'application/json' },
          cache: 'no-store',
          signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (data === null || typeof data !== 'object') throw new Error('invalid snapshot');
        return data;
      };

      function AccountUsagePill({ wide }) {
        const [snapshot, setSnapshot] = React.useState(null);
        const [failed, setFailed] = React.useState(false);
        const [revision, setRevision] = React.useState(0);

        React.useEffect(() => {
          let disposed = false;
          let timer = 0;
          let controller = null;
          const run = async () => {
            if (controller !== null) controller.abort();
            controller = new AbortController();
            let delay = POLL_MS;
            try {
              const next = await requestSnapshot(controller.signal);
              if (disposed) return;
              setSnapshot(next);
              setFailed(false);
              const changeAt = Number(next?.peak?.nextChangeAt);
              if (Number.isFinite(changeAt) && changeAt > Date.now() && changeAt - Date.now() < 6 * 3600_000) {
                delay = Math.min(delay, Math.max(1000, changeAt - Date.now() + 2000));
              }
            } catch (error) {
              if (disposed || error?.name === 'AbortError') return;
              setFailed(true);
              delay = 10_000;
            }
            if (!disposed) timer = window.setTimeout(run, delay);
          };
          run();
          const onVisible = () => {
            if (document.visibilityState !== 'visible') return;
            window.clearTimeout(timer);
            run();
          };
          document.addEventListener('visibilitychange', onVisible);
          window.addEventListener('focus', onVisible);
          return () => {
            disposed = true;
            if (controller !== null) controller.abort();
            window.clearTimeout(timer);
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('focus', onVisible);
          };
        }, [revision]);

        const wallets = Array.isArray(snapshot?.wallets) ? snapshot.wallets : [];
        const spend = Array.isArray(snapshot?.spend) ? snapshot.spend : [];
        const balanceWallet = pickPrimary(wallets);
        const spendWallet = pickPrimary(spend);
        const signedOut = snapshot !== null && snapshot.signedIn === false;
        const balanceText = balanceWallet
          ? `${symbolOf(balanceWallet.currency)}${formatAmount(balanceWallet.amount)}`
          : '—';
        const spendText = spendWallet
          ? `${symbolOf(spendWallet.currency)}${formatAmount(spendWallet.amount)}`
          : '—';
        let updated = null;
        if (snapshot?.updatedAt) {
          try {
            updated = new Date(snapshot.updatedAt).toLocaleTimeString(localeId(), {
              hour: '2-digit',
              minute: '2-digit',
            });
          } catch {
            updated = null;
          }
        }
        const tooltip = `${signedOut
          ? t('signedOut')
          : failed
            ? t('unavailable')
            : snapshot?.spendState === 'ready'
              ? `${t('updated')} ${updated ?? '—'}`
              : `${t('updated')} ${updated ?? '—'} · ${t('spendUnavailable')}`}\n${t('peakRule')}`;
        const label = signedOut
          ? t('signedOut')
          : `${t('balance')} ${balanceText} ${t('today')} ${spendText}`;
        const peak = snapshot?.peak ?? null;
        const peakActive = peak !== null && peak.active === true;
        const peakColor = peakActive
          ? 'var(--dsw-alias-state-warn-primary)'
          : 'var(--dsw-alias-state-success-primary)';
        const peakText = peakActive ? t('peak') : t('offPeak');
        let nextChange = '';
        if (peak?.nextChangeAt) {
          try {
            nextChange = new Intl.DateTimeFormat(localeId(), {
              timeZone: 'Asia/Shanghai',
              weekday: 'short',
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            }).format(new Date(peak.nextChangeAt));
          } catch {
            nextChange = '';
          }
        }

        const rail = !wide;
        const muted = {
          color: 'var(--dsw-alias-label-secondary)',
          flex: 'none',
        };
        const strong = {
          color: 'var(--dsw-alias-label-primary)',
          fontWeight: 500,
          flex: 'none',
        };
        const railSymbol = balanceWallet
          ? symbolOf(balanceWallet.currency).trim().slice(0, 3)
          : '¥';
        const pillStyle = rail
          ? {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 36,
            height: 36,
            padding: 0,
            boxSizing: 'border-box',
            borderRadius: 18,
            background: 'var(--dsw-alias-bg-layer-1)',
            border: '0.5px solid var(--dsw-alias-border-l1)',
            color: 'var(--dsw-alias-label-primary)',
            font: 'inherit',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
          }
          : {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'stretch',
            justifyContent: 'center',
            gap: 2,
            width: '100%',
            height: 46,
            padding: '0 10px',
            boxSizing: 'border-box',
            border: 'none',
            borderRadius: 8,
            background: 'transparent',
            color: 'var(--dsw-alias-label-primary)',
            font: 'inherit',
            fontSize: 12,
            lineHeight: '16px',
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            cursor: 'pointer',
            textAlign: 'left',
          };

        return h('div', {
          style: rail
            ? {
              flex: '0 0 36px',
              width: 36,
              height: 36,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }
            : {
              flex: '1 1 100%',
              minWidth: 0,
              display: 'flex',
            },
        }, h(React.Fragment, null,
          h('style', null, [
            '.dsau-pill{transition:background-color .15s var(--ds-ease-in-out)}',
            '.dsau-pill:hover{background:var(--dsw-alias-interactive-bg-hover)!important}',
            '.dsau-pill:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
          ].join('')),
          h('button', {
            type: 'button',
            className: 'dsau-pill',
            title: tooltip,
            'aria-label': label,
            onClick: () => setRevision((value) => value + 1),
            style: pillStyle,
          }, rail
            ? h('span', { style: { fontSize: 13 } }, railSymbol)
            : h(React.Fragment, null,
              h('span', {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: signedOut ? 'center' : 'space-between',
                  gap: 8,
                  minWidth: 0,
                },
              }, signedOut
                ? h('span', { style: muted }, t('signedOut'))
                : [
                  h('span', {
                    key: 'balance',
                    style: { display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 },
                  },
                  h('span', { style: muted }, t('balance')),
                  h('span', { style: strong }, balanceText)),
                  h('span', {
                    key: 'spend',
                    style: { display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 },
                  },
                  h('span', { style: muted }, t('today')),
                  h('span', { style: strong }, spendText)),
                ]),
              peak === null
                ? null
                : h('span', {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    minWidth: 0,
                    fontSize: 11,
                    lineHeight: '14px',
                    color: 'var(--dsw-alias-label-secondary)',
                  },
                },
                h('span', {
                  'aria-hidden': true,
                  style: {
                    width: 6,
                    height: 6,
                    flex: 'none',
                    borderRadius: 3,
                    background: peakColor,
                  },
                }),
                h('span', { style: { color: peakColor, fontWeight: 500, flex: 'none' } }, peakText),
                nextChange === ''
                  ? null
                  : h('span', {
                    style: {
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    },
                  }, `· ${t('nextChange')} ${nextChange}`))
            ))));
      }

      return AccountUsagePill;
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'account-usage: dictionaries');
        const Pill = createPill(ctx);
        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'sidebar-account-usage',
          order: 10,
        }, Pill));
      },
    };
  },
});
