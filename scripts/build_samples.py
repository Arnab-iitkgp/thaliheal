"""Sample dishes from the user's PDF 'Indian Food & Nutrition Guide' (final image corrections).
Values copied as printed. Blank (null) where the PDF gives nothing."""
import json, sys
OUT = sys.argv[1]
G = lambda ids=(), words=(), type=None: {k: v for k, v in dict(ids=list(ids), words=list(words), type=type).items() if v}
rows = [
 # id, name, diet, section, serving, weight_g, weight_note, kcal, P, C, F, Fib, dish_type, match groups
 ("s01","Veg Biryani","Vegetarian","Top 10 popular","1 plate (300 g)",300,None,450,9,75,13,4,"rice",[G(["veg_biryani","veg_pulao"],["biryani","pulao","pulav"])]),
 ("s02","Masala Dosa","Vegetarian","Top 10 popular","1 medium dosa (200 g)",200,None,350,7,55,11,4,"other",[G(["masala_dosa","plain_dosa"],["dosa"])]),
 ("s03","Idli Vada Sambar","Vegetarian","Top 10 popular","2 idlis + 1 vada + sambar (300 g)",300,None,350,12,53,10,6,"other",[G(["idli"],["idli"]),G(["medu_vada"],["vada"]),G(["sambar"],["sambar"])]),
 ("s04","Chole Bhature","Vegetarian","Top 10 popular","2 bhature + chole (350 g)",350,None,650,18,85,27,12,"other",[G(["chole"],["chole","chana","chickpea"]),G(["bhatura","puri"],["bhatur","puri"])]),
 ("s05","Roti Sabji Dal","Vegetarian","Top 10 popular","2 rotis + sabji + dal (400 g)",400,None,450,17,68,12,13,"other",[G(["chapati","tandoori_roti","plain_paratha"],["roti","chapati","phulka"]),G(type="dal"),G(type="sabzi")]),
 ("s06","Vegetable Momos","Vegetarian","Top 10 popular","6 steamed pieces (180 g)",180,None,250,7,42,6,3,"other",[G(["veg_momos"],["momo","dumpling"])]),
 ("s07","Chicken Biryani","Non-vegetarian","Top 10 popular","1 plate (350 g)",350,None,550,28,70,18,3,"rice",[G(["chicken_biryani"],["chicken biryani"])]),
 ("s08","Butter Chicken with Naan","Non-vegetarian","Top 10 popular","1 serving (approx. 350 g)",350,"approx.",650,35,55,30,3,"curry",[G(["butter_chicken"],["butter chicken","makhani"]),G(["butter_naan"],["naan"])]),
 ("s09","Chicken Momos","Non-vegetarian","Top 10 popular","6 steamed pieces (180 g)",180,None,300,16,40,8,2,"other",[G([],["chicken momo","chicken dumpling"])]),
 ("s10","Chicken Curry with Rice","Non-vegetarian","Top 10 popular","1 serving (350 g)",350,None,500,30,55,16,3,"curry",[G(["chicken_curry","butter_chicken"],["chicken curry","chicken masala"]),G(["plain_rice"],["rice"])]),
 ("s11","Kosha Mangsho","Non-vegetarian","West Bengal","1 bowl (250 g)",250,None,480,32,12,34,2,"curry",[G(["mutton_curry"],["mangsho","mutton","kosha"])]),
 ("s12","Shorshe Ilish","Non-vegetarian","West Bengal","1 piece with mustard gravy (200 g)",200,None,420,28,6,32,1,"curry",[G(["fish_curry"],["ilish","hilsa","shorshe","mustard fish"])]),
 ("s13","Chingri Malai Curry","Non-vegetarian","West Bengal","1 bowl (250 g)",250,None,450,28,8,34,1,"curry",[G(["prawn_curry"],["chingri","prawn","shrimp"])]),
 ("s14","Alur Dom (Bengali style)","Vegetarian","West Bengal","1 bowl (200 g)",200,None,300,6,44,12,5,"sabzi",[G(["dum_aloo","aloo_tamatar","aloo_matar","jeera_aloo"],["alur dom","dum aloo","aloo dum","potato curry"])]),
 ("s15","Mishti Doi","Vegetarian","West Bengal","1 bowl (150 g)",150,None,220,8,32,6,0,"sweet",[G([],["mishti doi","sweet curd","sweet yoghurt","sweet yogurt"])]),
 ("s16","Fish Kalia","Non-vegetarian","West Bengal","1 piece with gravy (220 g)",220,None,390,27,10,26,1,"curry",[G(["fish_curry"],["kalia","fish curry"])]),
 ("s17","Dahi Machh","Non-vegetarian","West Bengal","1 piece with yoghurt gravy (220 g)",220,None,360,28,8,22,1,"curry",[G(["fish_curry"],["dahi mach","doi mach","yoghurt fish","yogurt fish","curd fish"])]),
 ("s18","Chicken Kosha","Non-vegetarian","West Bengal","1 bowl (250 g)",250,None,430,34,10,28,1,"curry",[G(["chicken_curry"],["chicken kosha","kosha","chicken curry"])]),
 ("s19","Mutton Kosha","Non-vegetarian","West Bengal","1 bowl (250 g)",250,None,500,30,12,38,1,"curry",[G(["mutton_curry"],["mutton","kosha"])]),
 ("s20","Vegetarian High-Protein Bowl","Vegetarian","Healthy meals","1 bowl (350 g)",350,None,420,22,48,12,10,"other",[G(["paneer_bhurji","kadai_paneer"],["paneer","tofu"]),G(["chole"],["chickpea","chana","chole"])]),
 ("s21","Egg Meal Bowl","Contains egg","Healthy meals","2 eggs + brown rice + vegetables (350 g)",350,None,430,25,50,14,6,"other",[G(["boiled_egg"],["egg"]),G(["plain_rice"],["rice"])]),
 ("s22","Grilled Chicken Bowl","Contains chicken","Healthy meals","1 bowl (400 g)",400,None,480,36,42,16,8,"other",[G(["chicken_tikka","tandoori_chicken"],["grilled chicken","chicken"]),G(["plain_rice"],["rice"])]),
 ("s23","Dal-Roti-Salad Plate","Vegetarian","Healthy meals","1 bowl dal + 2 small rotis + salad (400 g)",400,None,400,18,60,10,12,"other",[G(type="dal"),G(["chapati"],["roti","chapati"]),G(["salad"],["salad"])]),
 ("s24","Chicken Salad with Eggs","Contains chicken and egg","Healthy meals","1 bowl (350 g)",350,None,380,34,18,18,6,"other",[G([],["chicken"]),G(["boiled_egg"],["egg"]),G(["salad"],["salad"])]),
 ("s25","Fish and Brown Rice Bowl","Contains fish","Healthy meals","1 bowl (400 g)",400,None,450,30,45,14,6,"other",[G(["fish_fry","fish_curry"],["fish"]),G(["plain_rice"],["rice"])]),
]
dishes = []
for r in rows:
    (id_, name, diet, section, serving, g, note, kcal, p, c, f, fib, dtype, groups) = r
    dishes.append(dict(id=id_, name=name, diet=diet, section=section, serving=serving,
        weight_g=g, weight_note=note, kcal=kcal, protein=p, carbs=c, fat=f, fibre=fib,
        photo=f"img/samples/{id_}.jpg", test_photo=f"img/test/{id_}.jpg",
        dish_type=dtype, match_groups=groups))
meta = {"source": "Indian Food & Nutrition Guide (user supplied PDF, final image corrections, 14 Nov 2026)",
        "note": "Reference values copied as printed. The PDF calls them approximate estimates per stated serving; they are not weighed or lab measured.",
        "missing": "Sugar is not given for any dish. Weight for Butter Chicken with Naan is approximate.",
        "match_groups": "Test mode only: a dish counts as named correctly when every group is found in the model's items, by table dish id, a word in the model's label, or a dish type."}
json.dump({"meta": meta, "dishes": dishes}, open(OUT, "w"), indent=1, ensure_ascii=False)
print(len(dishes))
