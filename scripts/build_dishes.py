"""Build dishes.json: per 100 g nutrients (excluding added cooking fat) from IFCT 2017 ingredients via standard recipes."""
import json, sys, csv

ifct = {r['code']: r for r in json.load(open(sys.argv[1]))}
OUT = sys.argv[2]
# Full IFCT composition table (for minerals and vitamins); values in that file are grams per 100 g.
COMP = sys.argv[3] if len(sys.argv) > 3 else "/home/claude/ext/ifct/ifct2017-compositions-2.0.9/package/index.csv"

def f(x):
    try: return float(x)
    except: return 0.0

# ingredient -> (protein, carbs, fat, fibre, sugar) per 100 g
ING = {}
for c, r in ifct.items():
    ING[c] = (f(r['protcnt']), f(r['choavldf']), f(r['fatce']), f(r['fibtg']), f(r['fsugar']))
# Supplementary ingredients not in IFCT 2017 (typical values, estimates)
EST = {
    'SUGAR': (0, 100, 0, 0, 100),
    'CURD': (3.1, 4.7, 3.3, 0, 4.7),
    'CREAM': (2.1, 3.4, 25, 0, 3.4),
    'PAV': (8.5, 49, 3.5, 2.4, 5.0),
    'SABUDANA': (0.2, 87, 0.2, 0.9, 0),
    'KETCHUP': (1.2, 25, 0.1, 0.3, 21),
    'SOY': (8, 5, 0, 0.8, 0.4),
    'CORNFLOUR': (0.3, 88, 0.1, 0.9, 0),
    'SOYA_CHUNKS': (52, 21, 0.5, 13, 3),
}
ING.update(EST)

# ---------------- Minerals and vitamins (added 14 Nov 2026, v0.3.0) ----------------
# Per 100 g raw ingredient: iron mg, calcium mg, zinc mg, magnesium mg, folate ug, vitamin C mg, vitamin A ug.
# Vitamin A is retinol + beta carotene / 8 (8:1 conversion, an app assumption to check against the RDA book).
MICRO_KEYS = ["iron", "calcium", "zinc", "magnesium", "folate", "vitc", "vita"]
MICRO = {}
with open(COMP, encoding="utf-8-sig") as fh:
    rd = csv.reader(fh); head = [c.split("; ")[-1] for c in next(rd)]; ix = {c: i for i, c in enumerate(head)}
    for row in rd:
        g = lambda k: f(row[ix[k]])
        MICRO[row[ix["code"]]] = (g("fe")*1000, g("ca")*1000, g("zn")*1000, g("mg")*1000, g("folsum")*1e6, g("vitc")*1000, g("retol")*1e6 + g("cartb")*1e6/8)
# Supplementary ingredients (typical published values, estimates)
MICRO_EST = {
    'SUGAR': (0, 0, 0, 0, 0, 0, 0),
    'CURD': (0.1, 120, 0.6, 12, 7, 0.5, 30),
    'CREAM': (0.1, 90, 0.3, 9, 4, 0.6, 200),
    'PAV': (1.5, 40, 0.7, 25, 30, 0, 0),
    'SABUDANA': (1.6, 20, 0.1, 1, 4, 0, 0),
    'KETCHUP': (0.35, 15, 0.17, 13, 9, 4, 25),
    'SOY': (1.45, 33, 0.4, 43, 18, 0, 0),
    'CORNFLOUR': (0.47, 2, 0.06, 3, 0, 0, 0),
    'SOYA_CHUNKS': (9.2, 240, 2.5, 290, 300, 0, 0),
}
MICRO.update(MICRO_EST)
# Cooked dishes: calculated vitamins run 32% to 45.5% above analysed values (Chiplonkar and Agte 2007), so
# vitamins C, folate and A are multiplied by 0.7. Minerals are kept (they stay in Indian dishes that keep their liquid).
VIT_RETENTION = 0.7
RAW = {"salad", "raita", "curd", "paneer", "banana", "apple", "mint_chutney", "coconut_chutney", "sweet_lassi", "chaas", "milk", "pickle", "bhel_puri"}
# Added sugar per 100 g ingredient (white sugar, jaggery, ketchup, bread)
ADDED_SUGAR = {'SUGAR': 100, 'I001': 85, 'KETCHUP': 20, 'PAV': 4}

def flags_for(ings, fat):
    """Diet flags from the recipe, used to filter food suggestions by diet type."""
    ks = list(ings)
    fl = {
        "dairy": any(k.startswith("L") or k in ("CURD", "CREAM") for k in ks),
        "ghee_fat": bool(fat and fat[0] in ("ghee", "butter") and fat[1] > 0),   # swap for oil in a vegan kitchen
        "egg": any(k.startswith("M") and k[1:].isdigit() for k in ks),
        "meat": any(k[0] in "NO" and k[1:].isdigit() for k in ks),
        "fish": any(k[0] in "PQRS" and k[1:].isdigit() for k in ks),
        "jain_avoid": any((k[0] in "FJ" and k[1:].isdigit()) or k == "G017" for k in ks),   # roots, tubers, onion, mushroom
    }
    return {k: v for k, v in fl.items() if v}

def kcal(p, c, fat, fib):
    return 4*p + 4*c + 9*fat + 2*fib

KATORI = 150   # g, medium katori of dal or sabzi (DGI 2024 lists 155 ml)
RICE_KATORI = 125
LADLE = 60     # g, standard serving ladle (karchi)
GLASS = 250
CUP = 150

def u(*pairs):
    return [{"name": n, "g": g} for n, g in pairs]

WET = lambda: u(("katori", KATORI), ("ladle", LADLE))
RICE = lambda: u(("katori", RICE_KATORI), ("serving spoon", 70))

dishes = []

def R(id, name, cat, units, ings, cooked, fat=None, aliases=(), veg=True, note=""):
    """ings: dict ingredient->raw g in batch; cooked: final cooked batch weight in g INCLUDING added fat.
    fat: (type, home_g, restaurant_g) added cooking fat for the batch, kept out of base nutrients."""
    P=C=F=FB=S=0.0
    for k, g in ings.items():
        p, c, fa, fb, s = ING[k]
        P += p*g/100; C += c*g/100; F += fa*g/100; FB += fb*g/100; S += s*g/100
    per = 100.0/cooked
    base = dict(protein=P*per, carbs=C*per, fat=F*per, fibre=FB*per, sugar=S*per)
    base['kcal'] = kcal(base['protein'], base['carbs'], base['fat'], base['fibre'])
    mic = [0.0]*7; asug = 0.0
    for k, g in ings.items():
        for i, v in enumerate(MICRO[k]): mic[i] += v*g/100
        asug += ADDED_SUGAR.get(k, 0)*g/100
    ret = 1 if id in RAW else VIT_RETENTION
    micro = {}
    for i, key in enumerate(MICRO_KEYS):
        v = mic[i]*per*(ret if key in ("folate", "vitc", "vita") else 1)
        micro[key] = round(v, 2 if key in ("iron", "zinc") else 1)
    base['added_sugar'] = asug*per
    d = dict(id=id, name=name, category=cat, veg=veg, aliases=list(aliases), units=units,
             per100g={k: round(v, 1) for k, v in base.items()}, micro=micro, flags=flags_for(ings, fat),
             source="IFCT 2017 ingredients, standard recipe calculation", quality="calc")
    if any(k in EST for k in ings):
        d['source'] += " (some ingredients estimated)"
    if fat:
        t, h, r = fat
        d['added_fat'] = dict(type=t, home=round(h*per, 2), restaurant=round(r*per, 2), street=round(r*per*1.1, 2))
    if note: d['note'] = note
    dishes.append(d)

def E(id, name, cat, units, kcal_, p, c, fat, fib, sug, aliases=(), veg=True, note="", flags="", added_sugar=0):
    """Typical values; no minerals or vitamins (micro is null). flags: space separated diet flags."""
    d = dict(id=id, name=name, category=cat, veg=veg, aliases=list(aliases), units=units,
             per100g=dict(kcal=kcal_, protein=p, carbs=c, fat=fat, fibre=fib, sugar=sug, added_sugar=added_sugar),
             micro=None, flags={k: True for k in flags.split()},
             source="Typical published values (estimate, fat included)", quality="estimate")
    if note: d['note'] = note
    dishes.append(d)

# ---------------- Rice and grains ----------------
R("plain_rice","Steamed rice","Rice",RICE(),{"A015":100},300,None,("chawal","plain rice","boiled rice","white rice"))
R("jeera_rice","Jeera rice","Rice",RICE(),{"A015":100,"G025":2},300,("ghee",8,15),("cumin rice",))
R("veg_pulao","Veg pulao","Rice",RICE(),{"A015":100,"D061":30,"F002":30,"D050":20,"G017":30},400,("ghee",12,22),("pulav","vegetable pulao"))
R("chicken_biryani","Chicken biryani","Rice",u(("plate",350),("katori",150)),{"A015":100,"N001":120,"CURD":40,"G017":60,"D076":30},450,("ghee",20,35),("biryani","murgh biryani"),veg=False)
R("mutton_biryani","Mutton biryani","Rice",u(("plate",350),("katori",150)),{"A015":100,"O001":120,"CURD":40,"G017":60,"D076":30},450,("ghee",22,38),("gosht biryani",),veg=False)
R("egg_biryani","Egg biryani","Rice",u(("plate",350),("katori",150)),{"A015":100,"M001":100,"G017":60,"D076":40},420,("oil",18,30),(),veg=False)
R("veg_biryani","Veg biryani","Rice",u(("plate",320),("katori",150)),{"A015":100,"D061":30,"F002":30,"F006":40,"D050":20,"CURD":30,"G017":50},420,("ghee",18,30),("tehri",))
R("lemon_rice","Lemon rice","Rice",RICE(),{"A015":100,"H012":15,"E033":15,"G010":2},310,("oil",10,15),("chitranna",))
R("curd_rice","Curd rice","Rice",RICE(),{"A015":60,"CURD":150,"L002":50},380,("oil",4,6),("thayir sadam","dahi chawal"))
R("khichdi","Khichdi","Rice",u(("katori",180),("ladle",LADLE)),{"A015":60,"B010":40},450,("ghee",8,15),("khichri",))
R("veg_fried_rice","Veg fried rice","Indo Chinese",u(("plate",300),("katori",150)),{"A015":100,"F002":30,"D050":20,"D015":30,"G017":30,"SOY":8},330,("oil",15,25),("fried rice",))
R("sabudana_khichdi","Sabudana khichdi","Snacks",u(("plate",200),("katori",150)),{"SABUDANA":100,"H012":30,"F006":50},250,("ghee",12,18),("sago khichdi",))
# ---------------- Breads ----------------
R("chapati","Chapati / roti","Breads",u(("piece",38)),{"A019":30},38,("ghee",0,2),("roti","phulka","chapathi","fulka"))
R("tandoori_roti","Tandoori roti","Breads",u(("piece",55)),{"A019":45},55,("butter",0,3),())
R("butter_naan","Butter naan","Breads",u(("piece",90)),{"A018":60,"CURD":10},85,("butter",5,8),("naan",))
R("plain_paratha","Plain paratha","Breads",u(("piece",60)),{"A019":45},60,("ghee",8,12),("parantha","lachha paratha"))
R("aloo_paratha","Aloo paratha","Breads",u(("piece",120)),{"A019":50,"F006":50,"G017":5},120,("ghee",10,15),("potato paratha",))
R("puri","Puri","Breads",u(("piece",28)),{"A019":20},28,("oil",5,6),("poori",),note="Fat is absorbed frying oil")
R("bhatura","Bhatura","Breads",u(("piece",80)),{"A018":50,"CURD":10},80,("oil",13,16),("bhature",),note="Fat is absorbed frying oil")
R("bajra_roti","Bajra roti","Breads",u(("piece",50)),{"A003":40},50,("ghee",3,4),("bajre ki roti","bhakri bajra"))
R("jowar_roti","Jowar roti / bhakri","Breads",u(("piece",50)),{"A005":40},50,("ghee",0,2),("jolada rotti","bhakri"))
R("makki_roti","Makki di roti","Breads",u(("piece",55)),{"A006":45},55,("ghee",5,8),("makki roti","maize roti"))
R("thepla","Methi thepla","Breads",u(("piece",45)),{"A019":30,"C020":10,"CURD":5},45,("oil",4,6),("thepla",))
R("pav","Pav (bread roll)","Breads",u(("piece",40)),{"PAV":40},44,("butter",4,8),("pao","bun"),note="Butter for toasting kept separate")
# ---------------- Dals and legumes ----------------
R("dal_tadka","Dal tadka (toor)","Dals",WET(),{"B021":40,"D076":20,"G017":15},220,("ghee",5,10),("dal fry","arhar dal","toor dal","dal","yellow dal"))
R("dal_makhani","Dal makhani","Dals",WET(),{"B004":40,"B020":8,"CREAM":10,"D076":30},230,("butter",10,20),("maa ki dal","kaali dal"))
R("chole","Chole / chana masala","Dals",WET(),{"B002":50,"G017":30,"D076":40},230,("oil",8,15),("chana masala","chickpea curry","chhole"))
R("rajma","Rajma","Dals",WET(),{"B020":50,"G017":30,"D076":40},230,("oil",7,12),("rajma masala","kidney bean curry"))
R("sambar","Sambar","Dals",WET(),{"B021":25,"D046":20,"D066":20,"D031":20,"G017":15,"D076":15,"E064":5},300,("oil",4,7),("sambhar",))
R("rasam","Rasam","Dals",u(("katori",150),("glass",200)),{"B021":5,"D076":40,"E064":5},250,("ghee",2,4),("saaru","chaaru"))
R("moong_dal","Moong dal","Dals",WET(),{"B010":40},220,("ghee",4,8),("yellow moong dal",))
R("masoor_dal","Masoor dal","Dals",WET(),{"B013":40,"D076":15,"G017":15},220,("ghee",4,8),("red lentil dal",))
R("kadhi","Kadhi pakora","Dals",WET(),{"CURD":120,"B001":30,"G017":10},250,("oil",8,14),("kadhi","punjabi kadhi"),note="Fat covers tempering and fried pakoras")
# ---------------- Vegetables ----------------
R("aloo_gobi","Aloo gobi","Vegetables",WET(),{"F006":100,"D036":100,"G017":20,"D076":20},210,("oil",12,20),("gobi aloo",))
R("bhindi_masala","Bhindi masala","Vegetables",WET(),{"D056":150,"G017":40,"D076":20},160,("oil",12,20),("bhindi fry","okra","ladies finger sabzi"))
R("palak_paneer","Palak paneer","Vegetables",WET(),{"C033":200,"L003":80,"G017":30,"D076":20,"CREAM":10},300,("ghee",12,22),("saag paneer",))
R("paneer_butter_masala","Paneer butter masala","Vegetables",WET(),{"L003":100,"D076":120,"H005":10,"CREAM":20,"G017":20},260,("butter",12,25),("paneer makhani","shahi paneer"))
R("kadai_paneer","Kadai paneer","Vegetables",WET(),{"L003":100,"D033":50,"G017":50,"D076":60},250,("oil",12,22),("karahi paneer",))
R("matar_paneer","Matar paneer","Vegetables",WET(),{"L003":80,"D061":60,"D076":80,"G017":40},280,("oil",12,20),("mutter paneer",))
R("aloo_matar","Aloo matar","Vegetables",WET(),{"F006":120,"D061":60,"D076":60,"G017":30},280,("oil",10,16),("aloo mutter",))
R("baingan_bharta","Baingan bharta","Vegetables",WET(),{"D031":250,"G017":40,"D076":50},220,("oil",12,18),("brinjal bharta","vangyache bharit"))
R("mixed_veg","Mixed veg sabzi","Vegetables",WET(),{"F002":40,"D050":40,"D061":40,"D036":40,"F006":40,"G017":30,"D076":30},260,("oil",12,20),("mix veg",))
R("jeera_aloo","Jeera aloo / aloo sabzi","Vegetables",WET(),{"F006":200,"G025":3},190,("oil",10,16),("aloo sabzi","potato sabzi","aloo fry"))
R("cabbage_sabzi","Cabbage sabzi / poriyal","Vegetables",WET(),{"D015":200,"D061":20,"H007":10},190,("oil",8,12),("patta gobhi","cabbage poriyal","thoran"))
R("lauki_sabzi","Lauki sabzi","Vegetables",WET(),{"D007":250,"D076":30,"G017":20},230,("oil",6,10),("bottle gourd sabzi","doodhi"))
R("malai_kofta","Malai kofta","Vegetables",WET(),{"L003":40,"F006":40,"H005":15,"A018":5,"D076":80,"G017":40,"CREAM":20},260,("oil",20,30),(),note="Fat covers fried koftas and gravy")
R("dum_aloo","Dum aloo","Vegetables",WET(),{"F006":150,"CURD":40,"D076":40,"G017":20},230,("oil",14,22),())
R("avial","Avial","Vegetables",WET(),{"D046":30,"F002":30,"D063":30,"D001":40,"D050":30,"H007":40,"CURD":40},250,("oil",8,12),("aviyal",),note="Coconut oil")
R("sarson_saag","Sarson ka saag","Vegetables",WET(),{"C026":200,"C033":60,"C008":40,"A006":10},250,("ghee",12,20),("saag",))
R("mushroom_masala","Mushroom masala","Vegetables",WET(),{"J001":200,"G017":40,"D076":50},230,("oil",10,18),("mushroom curry",))
# ---------------- Non veg ----------------
R("butter_chicken","Butter chicken","Non veg",WET(),{"N001":120,"D076":120,"CREAM":25,"H005":10,"CURD":20},300,("butter",15,30),("murgh makhani",),veg=False)
R("chicken_curry","Chicken curry","Non veg",WET(),{"N001":150,"G017":60,"D076":60,"CURD":20},300,("oil",12,22),("chicken masala","murgh curry"),veg=False)
R("chicken_tikka","Chicken tikka","Non veg",u(("piece",30),("plate (6 pcs)",180)),{"N003":150,"CURD":30},120,("butter",5,10),("tikka",),veg=False)
R("tandoori_chicken","Tandoori chicken","Non veg",u(("leg piece",110),("half",250)),{"N001":200,"CURD":30},160,("oil",5,10),(),veg=False,note="Edible portion, bone excluded")
R("mutton_curry","Mutton curry","Non veg",WET(),{"O001":150,"G017":60,"D076":50,"CURD":30},280,("oil",15,25),("rogan josh","mutton masala","gosht curry"),veg=False)
R("keema","Keema matar","Non veg",WET(),{"O001":150,"D061":40,"G017":50,"D076":50},250,("oil",12,20),("mince curry","keema"),veg=False)
R("fish_curry","Fish curry","Non veg",WET(),{"S006":150,"D076":50,"G017":30,"H007":20},280,("oil",10,18),("machli curry","meen curry","macher jhol"),veg=False)
R("fish_fry","Fish fry","Non veg",u(("piece",70)),{"S006":100,"A015":10},90,("oil",10,15),("tawa fish","rava fish fry"),veg=False)
R("prawn_curry","Prawn curry","Non veg",WET(),{"S009":150,"H007":30,"D076":50,"G017":30},270,("oil",10,18),("jhinga curry","prawn masala"),veg=False)
R("egg_curry","Egg curry","Non veg",WET(),{"M001":100,"G017":60,"D076":60},230,("oil",10,16),("anda curry",),veg=False,note="One katori holds about one egg")
R("boiled_egg","Boiled egg","Non veg",u(("piece",50)),{"M004":50},50,None,("anda","egg"),veg=False)
R("omelette","Omelette (2 eggs)","Non veg",u(("piece",115)),{"M001":100,"G017":20,"D076":10},115,("oil",5,8),("omlet","masala omelette"),veg=False)
R("chilli_chicken","Chilli chicken","Indo Chinese",u(("plate",230),("katori",150)),{"N003":150,"A018":15,"CORNFLOUR":10,"D033":40,"G017":40,"KETCHUP":10,"SOY":10},230,("oil",20,30),(),veg=False,note="Fat covers frying and tossing")
# ---------------- South Indian ----------------
R("idli","Idli","South Indian",u(("piece",40)),{"A014":15,"B003":5},40,None,("idly",))
R("plain_dosa","Plain dosa","South Indian",u(("piece",85)),{"A014":30,"B003":10},85,("oil",5,8),("dosai","sada dosa"))
R("masala_dosa","Masala dosa","South Indian",u(("piece",200)),{"A014":35,"B003":12,"F006":80,"G017":15},200,("oil",10,15),("masale dose",))
R("medu_vada","Medu vada","South Indian",u(("piece",45)),{"B003":25},45,("oil",6,8),("vada","uddina vada","vadai"),note="Fat is absorbed frying oil")
R("uttapam","Uttapam","South Indian",u(("piece",130)),{"A014":40,"B003":13,"G017":20,"D076":15},130,("oil",6,10),("uthappam",))
R("upma","Upma","South Indian",u(("katori",180),("plate",220)),{"A022":50,"G017":15,"D061":10,"F002":10},200,("oil",8,12),("uppittu","rava upma"))
R("poha","Poha","Snacks",u(("plate",160),("katori",120)),{"A011":50,"G017":20,"F006":30,"H012":10},160,("oil",7,10),("pohe","aval","chivda poha"))
R("pongal","Ven pongal","South Indian",u(("katori",180)),{"A015":40,"B010":20,"H005":5},220,("ghee",10,18),("khara pongal",))
R("coconut_chutney","Coconut chutney","Accompaniments",u(("tablespoon",15),("small katori",60)),{"H007":50,"B001":10},90,("oil",2,3),("nariyal chutney",))
# ---------------- Snacks and street food ----------------
R("samosa","Samosa","Snacks",u(("piece",70)),{"A018":25,"F006":45,"D061":5},70,("oil",12.5,14),("aloo samosa",),note="Oil uptake about 18% (Sakhale et al.)")
R("onion_pakora","Onion pakora","Snacks",u(("piece",15),("plate",100)),{"B001":30,"G017":40},65,("oil",13,15),("bhaji","bhajiya","pakoda","kanda bhaji"),note="Fat is absorbed frying oil")
R("pav_bhaji","Pav bhaji (bhaji only)","Snacks",WET(),{"F006":60,"D061":30,"D036":30,"D033":20,"D076":60,"G017":30},220,("butter",12,25),("bhaji",),note="Add pav separately")
R("vada_pav","Vada pav","Snacks",u(("piece",130)),{"PAV":40,"F006":60,"B001":15},130,("oil",10,12),("wada pav",))
R("pani_puri","Pani puri","Snacks",u(("plate (6 pcs)",150),("piece",25)),{"A022":15,"A018":5,"F006":20,"B002":10,"E064":5,"I001":8},150,("oil",7,8),("golgappa","puchka","gup chup"))
R("bhel_puri","Bhel puri","Snacks",u(("plate",110)),{"A012":30,"B001":10,"F006":20,"G017":15,"D076":15,"I001":5,"E064":3},110,("oil",5,7),("bhel",))
R("dhokla","Dhokla","Snacks",u(("piece",30),("plate (4 pcs)",120)),{"B001":40,"CURD":15,"SUGAR":3},110,("oil",3,5),("khaman",))
R("kachori","Kachori","Snacks",u(("piece",60)),{"A018":30,"B010":15},60,("oil",13,15),("khasta kachori",),note="Fat is absorbed frying oil")
R("aloo_tikki","Aloo tikki","Snacks",u(("piece",60)),{"F006":70,"D061":10,"A018":3},75,("oil",6,10),("tikki",))
R("veg_momos","Veg momos (steamed)","Snacks",u(("piece",25),("plate (6 pcs)",150)),{"A018":8,"D015":10,"F002":3,"G017":3},25,("oil",0.8,1.2),("momo","dumplings"))
R("hakka_noodles","Veg hakka noodles","Indo Chinese",u(("plate",250),("katori",150)),{"A018":70,"D015":40,"F002":20,"D033":20,"G017":20,"SOY":8},250,("oil",12,22),("chowmein","noodles"))
# ---------------- Accompaniments ----------------
R("curd","Curd (dahi)","Accompaniments",u(("katori",150)),{"CURD":100},100,None,("dahi","yogurt"))
R("paneer","Paneer (plain)","Accompaniments",u(("serving",50),("cube",15)),{"L003":100},100,None,("paneer","plain paneer","paneer cubes","पनीर"),note="Serving and cube weights are estimates.")
# Retinol for L003 comes from the IFCT Table 3 footnote omitted by the digitised row.
dishes[-1]["micro"]["vita"] = round(20.58 + 4.39 / 8, 1)
dishes[-1]["source"] = "IFCT 2017, paneer (L003, digitised values)"
R("raita","Raita","Accompaniments",u(("katori",150)),{"CURD":120,"D043":40},160,None,("cucumber raita","boondi raita"))
R("salad","Green salad (kachumber)","Accompaniments",u(("katori",100)),{"D043":50,"G017":30,"D076":50,"E033":5},135,None,("salad","kachumber"))
R("papad","Papad (roasted)","Accompaniments",u(("piece",12)),{"B003":12},12,None,("papadum","appalam"))
R("pickle","Mango pickle","Accompaniments",u(("tablespoon",15)),{"D057":60,"T006":25},100,None,("achar","aachar"),note="Oil in pickle is counted in the dish")
R("mint_chutney","Green chutney","Accompaniments",u(("tablespoon",15)),{"G016":30,"G009":30,"CURD":20},90,None,("pudina chutney","hari chutney"))
# ---------------- Sweets ----------------
R("gulab_jamun","Gulab jamun","Sweets",u(("piece",50)),{"L004":60,"A018":12,"SUGAR":60},200,("ghee",20,24),("gulabjamun",),note="Includes absorbed syrup")
R("jalebi","Jalebi","Sweets",u(("piece",25),("plate",100)),{"A018":50,"CURD":5,"SUGAR":70},150,("oil",25,28),("jilebi",))
R("kheer","Kheer","Sweets",u(("katori",150)),{"L002":400,"A015":20,"SUGAR":30,"H001":5},280,None,("payasam","rice kheer"))
R("rasgulla","Rasgulla","Sweets",u(("piece",50)),{"L003":18,"SUGAR":12},50,None,("rosogolla","rasagola"))
R("gajar_halwa","Gajar halwa","Sweets",u(("katori",120)),{"F002":200,"L002":200,"SUGAR":40,"L004":20},220,("ghee",15,25),("gajar ka halwa","carrot halwa"))
R("besan_ladoo","Besan ladoo","Sweets",u(("piece",40)),{"B001":40,"SUGAR":30},90,("ghee",20,22),("laddu","ladoo"))
# ---------------- Drinks ----------------
R("milk","Milk (whole cow)","Drinks",u(("glass",GLASS),("cup",CUP)),{"L002":100},100,None,("milk","plain milk","whole milk","cow milk","doodh","dudh","दूध"))
# IFCT 2017 Table 3 gives 58.25 µg retinol for L002 in a footnote omitted by the digitised row.
dishes[-1]["micro"]["vita"] = round(58.25 + 13.67 / 8, 1)
dishes[-1]["source"] = "IFCT 2017, whole cow milk (L002)"
R("masala_chai","Masala chai (with sugar)","Drinks",u(("cup",CUP),("glass",200)),{"L002":60,"SUGAR":8},150,None,("chai","tea","cutting chai"))
R("filter_coffee","Filter coffee (with sugar)","Drinks",u(("cup",120)),{"L002":90,"SUGAR":8},120,None,("coffee","kaapi"))
R("sweet_lassi","Sweet lassi","Drinks",u(("glass",GLASS)),{"CURD":200,"SUGAR":20},250,None,("lassi",))
R("chaas","Chaas (buttermilk)","Drinks",u(("glass",200)),{"CURD":60},200,None,("buttermilk","mattha","majjige"))
# ---------------- Fruit ----------------
R("banana","Banana","Fruit",u(("piece",100)),{"E012":100},100,None,("kela",),note="Edible portion")
R("apple","Apple","Fruit",u(("piece",150)),{"E001":150},150,None,("seb",),note="Edible portion")
# ---------------- Popular non Indian (typical values) ----------------
E("pizza_veg","Pizza (cheese / veg)","Fast food",u(("slice",100),("medium pizza",600)),266,11,33,10,2.3,3.6,("margherita","pizza slice"),flags="dairy jain_avoid",added_sugar=1.5)
E("pizza_chicken","Pizza (chicken)","Fast food",u(("slice",105),("medium pizza",630)),260,12.5,30,10,2,3.5,("chicken pizza",),veg=False,flags="dairy meat jain_avoid",added_sugar=1.5)
E("veg_burger","Veg burger","Fast food",u(("piece",150)),230,6,32,9,2.5,5,("aloo tikki burger","burger"),flags="dairy jain_avoid",added_sugar=3)
E("chicken_burger","Chicken burger","Fast food",u(("piece",170)),250,12,26,11,1.5,5,(),veg=False,flags="dairy egg meat jain_avoid",added_sugar=3)
E("french_fries","French fries","Fast food",u(("medium portion",110),("small portion",75),("large portion",150)),312,3.4,41,15,3.8,0.3,("fries","finger chips"),flags="jain_avoid",added_sugar=0)
E("fried_chicken","Fried chicken","Fast food",u(("piece",110)),260,20,9,16,0.5,0,("kfc chicken","chicken fry"),veg=False,note="Edible portion",flags="egg meat",added_sugar=0)
E("veg_sandwich","Grilled veg sandwich","Fast food",u(("piece",150)),230,7,30,9,2.5,4,("sandwich","bombay sandwich"),flags="dairy jain_avoid",added_sugar=2)
E("pasta_white","Pasta in white sauce","Fast food",u(("plate",250),("katori",150)),170,5,20,8,1,3,("white sauce pasta","alfredo"),flags="dairy",added_sugar=1)
E("pasta_red","Pasta in red sauce","Fast food",u(("plate",250),("katori",150)),140,4.5,22,4,1.8,4,("arrabbiata","red sauce pasta"),flags="jain_avoid",added_sugar=2)
E("chicken_wrap","Chicken shawarma / wrap","Fast food",u(("piece",200)),210,13,20,9,1.5,2,("shawarma","chicken roll","kathi roll"),veg=False,flags="dairy meat jain_avoid",added_sugar=1)
E("instant_noodles","Instant noodles (Maggi type)","Fast food",u(("packet cooked",230)),135,3,18.5,5.4,0.7,0.8,("maggi","instant noodles"),flags="jain_avoid",added_sugar=0.5)
E("cola","Cola / soft drink","Drinks",u(("glass",250),("can",330)),42,0,10.6,0,0,10.6,("coke","pepsi","soft drink","thums up"),flags="",added_sugar=10.6)
E("ice_cream","Ice cream (vanilla)","Sweets",u(("scoop",65),("cup",100)),207,3.5,24,11,0.7,21,("ice cream",),flags="dairy",added_sugar=17)
E("chocolate_cake","Chocolate cake","Sweets",u(("slice",80)),370,5,50,17,2,35,("cake","pastry"),flags="dairy egg",added_sugar=30)

# ---------------- Home style sabzis (added 14 Nov 2026) ----------------
R("tinda_masala","Tinda masala","Vegetables",WET(),{"D073":250,"G017":30,"D076":40},230,("oil",8,14),("tinde","tinda","tinde ki sabzi","round gourd"))
R("turai_sabzi","Turai sabzi","Vegetables",WET(),{"D068":250,"G017":25,"D076":30},230,("oil",6,10),("torai","tori","ridge gourd","dodka","beerakaya"))
R("karela_sabzi","Karela sabzi","Vegetables",WET(),{"D004":200,"G017":60},160,("oil",12,18),("karela fry","bitter gourd","pavakkai","kakarakaya"))
R("parwal_sabzi","Parwal aloo","Vegetables",WET(),{"D060":200,"F006":50,"G017":20},220,("oil",10,15),("parwal","potol","pointed gourd","parval"))
R("arbi_masala","Arbi masala","Vegetables",WET(),{"F004":200,"G017":20},190,("oil",10,16),("arvi","colocasia","kochu","sepankizhangu"))
R("kaddu_sabzi","Kaddu sabzi (khatta meetha)","Vegetables",WET(),{"D066":250,"I001":8},230,("oil",6,10),("kaddu","pumpkin","kumro","sitaphal sabzi"))
R("aloo_methi","Aloo methi","Vegetables",WET(),{"F006":150,"C020":80},180,("oil",10,16),("methi aloo",))
R("aloo_palak","Aloo palak","Vegetables",WET(),{"F006":100,"C033":200,"G017":20},230,("oil",8,14),("palak aloo",))
R("gobi_sabzi","Gobi sabzi (dry)","Vegetables",WET(),{"D036":250,"D061":20},220,("oil",10,16),("phool gobi","cauliflower sabzi","gobi matar"))
R("beans_sabzi","Beans sabzi / poriyal","Vegetables",WET(),{"D050":200,"F002":30,"H007":10},200,("oil",8,12),("french beans","beans poriyal","beans thoran","farasbi"))
R("gajar_matar","Gajar matar","Vegetables",WET(),{"F002":150,"D061":100},220,("oil",8,12),("carrot peas",))
R("aloo_shimla_mirch","Aloo shimla mirch","Vegetables",WET(),{"F006":120,"D033":120,"G017":20},220,("oil",10,16),("capsicum aloo","shimla mirch"))
R("aloo_baingan","Aloo baingan","Vegetables",WET(),{"F006":100,"D031":150,"D076":40},240,("oil",10,16),("baingan aloo","brinjal potato","vangi batata"))
R("bharwa_baingan","Bharwa baingan","Vegetables",WET(),{"D031":200,"H012":20,"H007":15,"G017":30},210,("oil",14,20),("stuffed brinjal","bharli vangi","gutti vankaya","ennai kathirikai"))
R("gavar_sabzi","Gavar sabzi","Vegetables",WET(),{"D039":200,"G017":20},190,("oil",8,12),("cluster beans","guar","gawar"))
R("kathal_sabzi","Kathal sabzi","Vegetables",WET(),{"D051":250,"G017":40,"D076":40},260,("oil",12,18),("jackfruit curry","echor","raw jackfruit"))
R("sem_sabzi","Sem ki sabzi","Vegetables",WET(),{"D047":200,"F006":50},220,("oil",8,12),("sem","papdi","avarekai","flat beans"))
R("lauki_chana_dal","Lauki chana dal","Vegetables",WET(),{"D007":200,"B001":30,"D076":30},260,("oil",6,10),("doodhi chana dal","lauki dal"))
R("aloo_tamatar","Aloo tamatar (rasedar)","Vegetables",WET(),{"F006":150,"D076":100},300,("oil",8,12),("aloo rassa","batata rassa","aloo curry","aloo ki sabzi gravy"))
R("matar_mushroom","Matar mushroom","Vegetables",WET(),{"J001":150,"D061":80,"G017":40,"D076":60},300,("oil",12,18),("mushroom matar",))
R("paneer_bhurji","Paneer bhurji","Vegetables",WET(),{"L003":150,"G017":40,"D076":40,"D033":20},230,("butter",10,15),("bhurji",))
R("soya_chunks_curry","Soya chunks curry","Vegetables",WET(),{"SOYA_CHUNKS":50,"G017":50,"D076":60,"F006":50},280,("oil",10,16),("soya curry","meal maker","nutrela"))
R("green_leafy_sabzi","Green leafy sabzi (generic)","Vegetables",WET(),{"C002":150,"C033":100,"G017":20},200,("oil",8,12),("chaulai","saag bhaji","palak sabzi","keerai","greens"),note="Generic: amaranth and spinach")
R("masaledar_sabzi","Masaledar sabzi (generic gravy)","Vegetables",WET(),{"F006":60,"D036":50,"D061":40,"F002":30,"G017":60,"D076":80},280,("oil",14,22),("masala sabzi","gravy sabzi","rassedar sabzi","tari wali sabzi"),note="Generic: mixed vegetables in onion tomato gravy")
R("sukhi_sabzi","Sukhi sabzi (generic dry)","Vegetables",WET(),{"F006":80,"D050":50,"F002":50,"D036":60},220,("oil",10,16),("dry sabzi","bhaji","poriyal","palya","thoran"),note="Generic: mixed dry vegetables")

# ---------------- Dish types (fixed list used in test mode) ----------------
TYPES = ["dal", "sabzi", "rice", "roti", "curry", "fried snack", "sweet", "other"]
CAT_TYPE = {"Rice": "rice", "Breads": "roti", "Dals": "dal", "Vegetables": "sabzi", "Non veg": "curry", "Sweets": "sweet"}
TYPE_OVERRIDE = {
    "sabudana_khichdi": "other", "veg_fried_rice": "rice",
    "palak_paneer": "curry", "paneer_butter_masala": "curry", "kadai_paneer": "curry", "matar_paneer": "curry", "malai_kofta": "curry",
    "chicken_tikka": "other", "tandoori_chicken": "other", "fish_fry": "other", "boiled_egg": "other", "omelette": "other",
    "samosa": "fried snack", "onion_pakora": "fried snack", "vada_pav": "fried snack", "kachori": "fried snack", "aloo_tikki": "fried snack",
    "pani_puri": "fried snack", "medu_vada": "fried snack", "french_fries": "fried snack", "fried_chicken": "fried snack",
    "kadhi": "dal",
}
for d in dishes:
    d["type"] = TYPE_OVERRIDE.get(d["id"], CAT_TYPE.get(d["category"], "other"))
    assert d["type"] in TYPES

FATS = {
    "oil":    {"name": "Cooking oil", "per_g": {"kcal": 9.0, "protein": 0, "carbs": 0, "fat": 1.0, "fibre": 0, "sugar": 0, "added_sugar": 0}, "source": "IFCT 2017 (100% fat)"},
    "ghee":   {"name": "Ghee", "per_g": {"kcal": 9.0, "protein": 0, "carbs": 0, "fat": 1.0, "fibre": 0, "sugar": 0, "added_sugar": 0}, "source": "IFCT 2017 (100% fat)"},
    "butter": {"name": "Butter", "per_g": {"kcal": 7.2, "protein": 0.01, "carbs": 0.0, "fat": 0.81, "fibre": 0, "sugar": 0, "added_sugar": 0}, "source": "Typical values (estimate)"},
}

meta = {
    "version": "0.3.0",
    "built": "2026-11-14",
    "basis": "Nutrients per 100 g of cooked dish, EXCLUDING added cooking fat. Added oil, ghee or butter is a separate item: added_fat gives grams of fat per 100 g of dish for home, restaurant and street cooking.",
    "energy_formula": "kcal = 4 x protein + 4 x available carbs + 9 x fat + 2 x fibre (FAO / IFCT factors)",
    "sources": ["IFCT 2017, ICMR NIN (ingredient composition, via the @ifct2017/compositions digitisation)", "Standard recipes and cooked yields (in house estimates)", "Typical published values for non Indian fast food (estimates)"],
    "types": TYPES,
    "micro": {"keys": MICRO_KEYS, "units": {"iron": "mg", "calcium": "mg", "zinc": "mg", "magnesium": "mg", "folate": "ug", "vitc": "mg", "vita": "ug"},
              "basis": "Per 100 g of cooked dish from IFCT 2017 ingredients. Vitamins C, folate and A multiplied by 0.7 for cooking (calculated values run 32% to 45.5% high, Chiplonkar and Agte 2007), except raw dishes. Vitamin A = retinol + beta carotene / 8. The digitised milk row omits retinol for dairy recipe estimates; plain whole cow milk includes the published retinol value. Added cooking fat adds no minerals or vitamins here. Fast food rows have no minerals or vitamins (micro is null).",
              "not_covered": "Vitamin B12, vitamin D, iodine and added salt are not counted."},
    "flags_note": "flags: dairy, ghee_fat (ghee or butter as the home cooking fat), egg, meat, fish, jain_avoid (roots, tubers, onion, mushroom). Computed from recipe ingredients; fast food set by hand.",
    "units_note": "Medium katori 150 g (DGI 2024 lists 155 ml); serving ladle 60 g; glass 250 ml; cup 150 ml. Piece weights are estimates.",
    "licence_note": "Prototype only. IFCT data needs written permission from ICMR NIN before commercial use."
}
json.dump({"meta": meta, "fats": FATS, "dishes": dishes}, open(OUT, "w"), indent=1, ensure_ascii=False)
print(len(dishes), "dishes")
