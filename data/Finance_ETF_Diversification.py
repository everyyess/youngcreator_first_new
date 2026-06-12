import yfinance as yf
import json
import sys
import os
import math
import datetime
import threading
import pandas as pd
import numpy as np
import itertools

# ==========================================
# STEP 1 â íë¼ë¯¸í° ìë ¥ ë° ì¼ìí ì±í¥ ì¤ì 
# ==========================================
print("="*60)
print("ð íë§ ETF 30ì¢ëª© ë¤ê°í ìµì í ì°ì° ìì§ (íµí© êµì  ìì±í)")
print("  ð 'conservative' : ìì í (ìê´ê³ì + ë³ëì± ê·¹ì ë¦¬ì¤í¬ ëíì¤)")
print("  ð 'balanced'     : ë°¸ë°ì¤í (ìê´ê³ì + ì¤íì§ì ë¦¬ì¤í¬ í¨ì¨ ìíìì°)")
print("  ð 'aggressive'   : ê³µê²©í (ìê´ê³ì + ëì  ìììµë¥  CAGR ì£¼ëì£¼ ê·¹ëí)")
print("="*60)

strategy_input = input("ð í¬ì ì±í¥ ì§ì  (conservative / balanced / aggressive): ").strip().lower()
if strategy_input not in ["conservative", "balanced", "aggressive"]:
    strategy_input = "balanced"

k_input = input("ð ì¶ì² ETF ê°ì K ì¤ì  (ê¸°ë³¸ê°: 3): ").strip()
K = int(k_input) if k_input.isdigit() else 3

period = "3y" 

# ==========================================
# STEP 2 â ë°ì´í° ìì§ (yfinance ë³ë ¬ ë¤ì´ë¡ë)
# ==========================================
B1 = "SOXX,URA,AIQ,CIBR,BOTZ,ICLN,XAR,ARKG,IPAY,QTUM,PAVE,LIT,REMX,DTCR,VGLT,VGIT"
B2 = "VGSH,AGG,VTI,VOO,IBIT,SLV,GLD,USO,UNG,WEAT,CORN,QQQ,069500.KS,229200.KS"

def fetch_batch(tickers, current_period, outfile):
    try:
        raw = yf.download(tickers, period=current_period, auto_adjust=True, progress=False)
        if raw is None or raw.empty: return False

        close = raw["Close"] if isinstance(raw.columns, pd.MultiIndex) else raw[["Close"]]
        if isinstance(close, pd.Series): close = close.to_frame(name=tickers[0])
        close.columns = [str(c).upper() for c in close.columns]
        close = close[tickers].ffill().dropna()

        dates  = [str(d.date()) for d in close.index]
        prices = {t: [round(float(v),2) if not np.isnan(v) else None for v in close[t]] for t in tickers}

        result = {"tickers": tickers, "period": current_period,
                  "start": dates[0], "end": dates[-1], "trading_days": len(dates),
                  "dates": dates, "prices": prices}
        with open(outfile, 'w', encoding='utf-8') as f: 
            json.dump(result, f, ensure_ascii=False)
        return True
    except Exception as e:
        return False

t1 = [t.strip() for t in B1.split(",")]
t2 = [t.strip() for t in B2.split(",")]

file_b1 = './etf_b1.json'
file_b2 = './etf_b2.json'

print("\nð ë°ì´í° ë¡ë© ì¤...")
th1 = threading.Thread(target=fetch_batch, args=(t1, period, file_b1))
th2 = threading.Thread(target=fetch_batch, args=(t2, period, file_b2))
th1.start(); th2.start()
th1.join();  th2.join()

# ==========================================
# STEP 3 â ê¸ìµê³µí ì±í¥ë³ ì¤ì½ì´ ì°ì° ìì§
# ==========================================
with open(file_b1, encoding='utf-8') as f: d1 = json.load(f)
with open(file_b2, encoding='utf-8') as f: d2 = json.load(f)

dates_common = sorted(set(d1['dates']) & set(d2['dates']))
idx1 = {d:i for i,d in enumerate(d1['dates'])}
idx2 = {d:i for i,d in enumerate(d2['dates'])}

tickers_ordered = [
    "SOXX","URA","AIQ","CIBR","BOTZ","ICLN","XAR","ARKG","IPAY","QTUM",
    "PAVE","LIT","REMX","DTCR","VGLT","VGIT","VGSH","AGG",
    "VTI","VOO","IBIT","SLV","GLD","USO","UNG","WEAT","CORN","QQQ","069500.KS","229200.KS"
]
prices_raw = {}
for t in d1['tickers']:  prices_raw[t] = [d1['prices'][t][idx1[d]] for d in dates_common]
for t in d2['tickers']:  prices_raw[t] = [d2['prices'][t][idx2[d]] for d in dates_common]

tickers   = tickers_ordered
dates_all = dates_common
N         = len(dates_all)

SECTOR_MAP = {
    "SOXX":"ë°ëì²´","URA":"ìì Â·ì°ë¼ë","AIQ":"AIÂ·ë¹ë°ì´í°","CIBR":"ì¬ì´ë²ë³´ì","BOTZ":"ë¡ë³´í±ì¤","ICLN":"ì²­ì ìëì§",
    "XAR":"ë°©ì°Â·ì°ì£¼í­ê³µ","ARKG":"ë°ì´ì¤íí¬","IPAY":"ííí¬","QTUM":"ììì»´í¨í","PAVE":"ì¸íë¼","LIT":"2ì°¨ì ì§Â·ë¦¬í¬",
    "REMX":"í¬í ë¥Â·ì ëµìì¬","DTCR":"ë°ì´í°ì¼í°","VGLT":"ì±ê¶(ì¥ê¸°)","VGIT":"ì±ê¶(ì¤ê¸°)","VGSH":"ì±ê¶(ë¨ê¸°)","AGG":"ì±ê¶(ì¢í©)",
    "VTI":"ìì¥ì ì²´","VOO":"ìì¥ì ì²´","IBIT":"ìí¸íí","SLV":"ê·ê¸ìÂ·ììì¬","GLD":"ê·ê¸ìÂ·ììì¬","USO":"ìëì§ììì¬",
    "UNG":"ìëì§ììì¬","WEAT":"ëì°ë¬¼ììì¬","CORN":"ëì°ë¬¼ììì¬","QQQ":"ìì¥ì ì²´","069500.KS":"íêµ­ìì¥","229200.KS":"íêµ­ìì¥"
}
ETF_NAME = {
    "SOXX":"iShares Semiconductor ETF","URA":"Global X Uranium & Nuclear ETF","AIQ":"Global X AI & Technology ETF",
    "CIBR":"First Trust NASDAQ Cybersecurity ETF","BOTZ":"Global X Robotics & AI ETF","ICLN":"iShares Global Clean Energy ETF",
    "XAR":"SPDR Aerospace & Defense ETF","ARKG":"ARK Genomic Revolution ETF","IPAY":"ETFMG Prime Mobile Payments ETF",
    "QTUM":"Defiance Quantum Computing ETF","PAVE":"Global X US Infrastructure Dev ETF","LIT":"Global X Lithium & Battery Tech ETF",
    "REMX":"VanEck Rare Earth & Strategic Metals ETF","DTCR":"Global X Data Center & Digital Infra ETF","VGLT":"Vanguard Long-Term Treasury ETF",
    "VGIT":"Vanguard Intermediate-Term Treasury ETF","VGSH":"Vanguard Short-Term Treasury ETF","AGG":"iShares Core US Aggregate Bond ETF",
    "VTI":"Vanguard Total Stock Market ETF","VOO":"Vanguard S&P 500 ETF","IBIT":"iShares Bitcoin Trust ETF","SLV":"iShares Silver Trust",
    "GLD":"SPDR Gold Shares","USO":"United States Oil Fund","UNG":"United States Natural Gas Fund","WEAT":"Teucrium Wheat Fund",
    "CORN":"Teucrium Corn Fund","QQQ":"Invesco QQQ Trust (Nasdaq-100)","069500.KS":"KODEX 200 (ì½ì¤í¼200)","229200.KS":"KODEX ì½ì¤ë¥150"
}

def returns(p):
    return [p[i]/p[i-1]-1 for i in range(1,len(p))]
def pearson(a,b):
    n=len(a)
    if n<2: return 0
    ma,mb=sum(a)/n,sum(b)/n
    num=da=db=0
    for i in range(n):
        x,y=a[i]-ma,b[i]-mb; num+=x*y; da+=x*x; db+=y*y
    return num/math.sqrt(da*db) if da and db else 0

PERIOD_SLICES = { "1W": 5, "1M": 21, "3M": 63, "6M": 126, "1Y": 252, "3Y": N }

all_vols = {}
all_sharpes = {}
strategy_scores = {}

for t in tickers:
    ret_series = returns(prices_raw[t])
    mean_r = sum(ret_series)/len(ret_series) if ret_series else 0
    var_r = sum((x-mean_r)**2 for x in ret_series)/len(ret_series) if ret_series else 0
    std_r = math.sqrt(var_r) if var_r > 0 else 0.0001
    
    all_vols[t] = std_r
    ann_return = (prices_raw[t][-1] / prices_raw[t][0]) - 1
    
    if strategy_input == "aggressive":
        strategy_scores[t] = ann_return if ann_return > 0 else 0.001
        all_sharpes[t] = strategy_scores[t]
    elif strategy_input == "balanced":
        ann_ret_annual = ann_return / 3
        strategy_scores[t] = ann_ret_annual / (std_r * math.sqrt(252)) if std_r > 0 else 0
        if strategy_scores[t] < 0: strategy_scores[t] = 0.001
        all_sharpes[t] = strategy_scores[t]
    else:
        strategy_scores[t] = std_r
        all_sharpes[t] = 0.001

def greedy_regime_optimal(cm, tickers, k, strategy, vols, sharpes):
    sectors = {t:SECTOR_MAP[t] for t in tickers}
    selected = []
    used_sectors = set()
    remaining = list(tickers)
    
    def calculate_score(t_a, t_b):
        c = cm[t_a][t_b]
        if strategy in ["aggressive", "balanced"]:
            denom = (sharpes[t_a] + sharpes[t_b])
            return c / (denom if denom > 0 else 0.001)
        else:
            return (c + 1.01) * (vols[t_a] + vols[t_b])

    best_pair, best_score = None, 999999
    for i in range(len(remaining)):
        for j in range(i+1, len(remaining)):
            a, b = remaining[i], remaining[j]
            if sectors[a] == sectors[b]: continue
            score = calculate_score(a, b)
            if score < best_score:
                best_score = score
                best_pair = (a, b)
                
    if best_pair:
        for t in best_pair:
            selected.append(t)
            remaining.remove(t)
            used_sectors.add(sectors[t])
            
    while len(selected) < k and remaining:
        cands = [t for t in remaining if sectors[t] not in used_sectors]
        if not cands: cands = list(remaining)
        
        best_t, best_t_score = None, 999999
        for t in cands:
            avg_score = sum(calculate_score(t, s) for s in selected) / len(selected)
            if avg_score < best_t_score:
                best_t_score = avg_score
                best_t = t
        if not best_t: break
        selected.append(best_t)
        remaining.remove(best_t)
        used_sectors.add(sectors[best_t])
        
    return selected[:k]

period_results={}
for pname, n_days in PERIOD_SLICES.items():
    sl = min(n_days, N)
    dates_sl = dates_all[-sl:]
    prices_sl = {t:prices_raw[t][dates_all.index(dates_sl[0]):dates_all.index(dates_sl[-1])+1] for t in tickers}
    rets = {t:returns(prices_sl[t]) for t in tickers}
    
    cm = {}
    for t in tickers:
        cm[t] = {}
        for t2 in tickers:
            if t == t2: cm[t][t2] = 1.0
            elif t2 in cm and t in cm[t2]: cm[t][t2] = cm[t2][t]
            else: cm[t][t2] = round(pearson(rets[t], rets[t2]), 4)
            
    pairs = list(itertools.combinations(tickers, 2))
    global_avg = sum(cm[a][b] for a, b in pairs) / len(pairs)
    
    optimal = greedy_regime_optimal(cm, tickers, K, strategy_input, all_vols, all_sharpes)
    opt_pairs = list(itertools.combinations(optimal, 2))
    opt_avg = sum(cm[a][b] for a, b in opt_pairs) / len(opt_pairs) if opt_pairs else 0
    opt_score = max(0, min(100, round((1 - opt_avg) * 100)))
    
    inv_vols = {t: 1.0 / all_vols[t] if all_vols[t] > 0 else 1000 for t in optimal}
    total_inv = sum(inv_vols.values())
    raw_w = {t: inv_vols[t] / total_inv for t in optimal}
    
    period_results[pname] = {
        "start": dates_sl[0], "end": dates_sl[-1], "n_days": len(dates_sl),
        "corr_matrix": cm, "optimal": optimal, "opt_avg_corr": round(opt_avg, 4),
        "opt_score": opt_score, "global_avg": round(global_avg, 4),
        "dates": dates_sl, "prices": prices_sl,
        "capped_weights": raw_w, "scores": strategy_scores 
    }

# ==========================================
# STEP 4 â ë¸ë¼ì°ì  ì¶©ë ë°©ì§ì© Safe JSON ì²ë¦¬ ìì§ (íµì¬ ìì ë¶)
# ==========================================
class SafeJSONEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, np.integer): return int(obj)
        if isinstance(obj, np.floating):
            if np.isnan(obj) or np.isinf(obj): return None
            return float(obj)
        if isinstance(obj, np.ndarray): return obj.tolist()
        if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)): return None
        return super(SafeJSONEncoder, self).default(obj)

# ëª¨ë  í¹ì ë°ì´í° íìì ìë²½íê² íì¤í
PERIOD_DATA_JS = json.dumps(period_results, cls=SafeJSONEncoder, ensure_ascii=False)

template_path = './template.html'
try:
    with open(template_path, 'r', encoding='utf-8') as f:
        html_content = f.read()
except FileNotFoundError:
    print(f"\nâ ì¤ë¥: '{template_path}' íì¼ì ì°¾ì ì ììµëë¤.")
    sys.exit(1)

strategy_text = "âï¸ ë°¸ë°ì¤í (Balanced â ìê´ê³ì+ì¤íì§ì ëª¨ë¸)" if strategy_input == "balanced" else ("ð¥ ê³µê²©í (Aggressive â ìê´ê³ì+ëì  ìììµë¥  ëª¨ë¸)" if strategy_input == "aggressive" else "ð¡ï¸ ìì í (Conservative â ìê´ê³ì+ë³ëì± ëíì¤ ëª¨ë¸)")

HTML = (html_content
    .replace('##PERIOD_DATA_JS##', PERIOD_DATA_JS)
    .replace('##K_VAL_JS##', str(K))
    .replace('##STRATEGY_TYPE##', strategy_input)
    .replace('##STRATEGY_TXT##', strategy_text))

with open('./etf_diversification.html', 'w', encoding='utf-8') as f:
    f.write(HTML)

print(f"\nð [ìµì¢ ë¦¬í©í ë§ ìì í] ë¹ëê° ìë²½í ìë£ëììµëë¤.")
print(f"ð ìì± ëìë³´ë íì¼ ê²½ë¡: {os.path.abspath('./etf_diversification.html')}")

p = period_results.get("3Y")
print("\n" + "â"*60)
print(f"ð ETF ë¶ì°í¬ì ìµì í ë¦¬í¬í¸ â {strategy_text}")
print(f"ë¶ì ë²ì: {p['start']} ~ {p['end']} ({p['n_days']}ê±°ëì¼) [3Y ëì©ë íµê³ íë ì ì ì©]")
print(f"âââ ìì¤í ì ì  ìµì  ì¡°í© âââ")
for t in p['optimal']:
    print(f" â {t} ({SECTOR_MAP[t]}): {ETF_NAME.get(t, t)}")
print(f"\n â¡ï¸ ì¡°í© ë´ íê·  ìê´ê³ì: {p['opt_avg_corr']:.4f} | ë¤ê°í ì¤ì½ì´: {p['opt_score']}/100ì ")
print("â"*60)