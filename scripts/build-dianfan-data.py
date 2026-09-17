#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Extract vocabulary from Dianfan English 1A (牛津阅读树 1A) LRC files
and generate structured JSON & TypeScript datasets for the W-English app.
"""

import glob
import json
import os
import re
from collections import Counter
from pathlib import Path

# Built-in dictionary of linguistic metadata for Dianfan 1A words
# (zh meaning, IPA, emoji, track: 'phonics'|'sight', phonics_type: 'cvc'|'blend'|'vowel_digraph'|'r_controlled'|'other')
WORDS_META = {
    "a": {"zh": "一个", "ipa": "/eɪ/", "emoji": "🔤", "track": "sight", "type": "high_frequency"},
    "after": {"zh": "在...之后", "ipa": "/ˈæftər/", "emoji": "⏳", "track": "sight", "type": "high_frequency"},
    "again": {"zh": "又，再次", "ipa": "/əˈɡɛn/", "emoji": "🔄", "track": "sight", "type": "high_frequency"},
    "all": {"zh": "全部", "ipa": "/ɔːl/", "emoji": "🌐", "track": "sight", "type": "high_frequency"},
    "am": {"zh": "是", "ipa": "/æm/", "emoji": "🙋", "track": "phonics", "type": "cvc"},
    "an": {"zh": "一个", "ipa": "/æn/", "emoji": "🔤", "track": "phonics", "type": "cvc"},
    "and": {"zh": "和，而且", "ipa": "/ænd/", "emoji": "➕", "track": "phonics", "type": "blend"},
    "angle": {"zh": "角，角度", "ipa": "/ˈæŋɡəl/", "emoji": "📐", "track": "phonics", "type": "other"},
    "are": {"zh": "是", "ipa": "/ɑːr/", "emoji": "👥", "track": "sight", "type": "high_frequency"},
    "as": {"zh": "像...一样", "ipa": "/æz/", "emoji": "🟰", "track": "phonics", "type": "cvc"},
    "at": {"zh": "在...", "ipa": "/æt/", "emoji": "📍", "track": "phonics", "type": "cvc"},
    "away": {"zh": "离开", "ipa": "/əˈweɪ/", "emoji": "💨", "track": "sight", "type": "high_frequency"},
    "back": {"zh": "回来，后面", "ipa": "/bæk/", "emoji": "🔙", "track": "phonics", "type": "cvc"},
    "ball": {"zh": "球", "ipa": "/bɔːl/", "emoji": "⚽", "track": "phonics", "type": "other"},
    "bang": {"zh": "砰地一声", "ipa": "/bæŋ/", "emoji": "💥", "track": "phonics", "type": "blend"},
    "beach": {"zh": "海滩", "ipa": "/biːtʃ/", "emoji": "🏖️", "track": "phonics", "type": "vowel_digraph"},
    "bear": {"zh": "熊", "ipa": "/bɛər/", "emoji": "🐻", "track": "phonics", "type": "r_controlled"},
    "beard": {"zh": "胡须", "ipa": "/bɪərd/", "emoji": "🧔", "track": "phonics", "type": "r_controlled"},
    "bed": {"zh": "床", "ipa": "/bɛd/", "emoji": "🛏️", "track": "phonics", "type": "cvc"},
    "best": {"zh": "最好的", "ipa": "/bɛst/", "emoji": "🥇", "track": "phonics", "type": "blend"},
    "biff": {"zh": "比夫 (主角)", "ipa": "/bɪf/", "emoji": "👧", "track": "sight", "type": "name"},
    "big": {"zh": "大的", "ipa": "/bɪɡ/", "emoji": "🐘", "track": "phonics", "type": "cvc"},
    "bike": {"zh": "自行车", "ipa": "/baɪk/", "emoji": "🚲", "track": "phonics", "type": "magic_e"},
    "bin": {"zh": "垃圾桶", "ipa": "/bɪn/", "emoji": "🗑️", "track": "phonics", "type": "cvc"},
    "birthday": {"zh": "生日", "ipa": "/ˈbɜːrθdeɪ/", "emoji": "🎂", "track": "phonics", "type": "compound"},
    "blue": {"zh": "蓝色的", "ipa": "/bluː/", "emoji": "🔵", "track": "phonics", "type": "blend"},
    "blues": {"zh": "蓝队，蓝色", "ipa": "/bluːz/", "emoji": "👕", "track": "phonics", "type": "blend"},
    "boots": {"zh": "靴子", "ipa": "/buːts/", "emoji": "🥾", "track": "phonics", "type": "vowel_digraph"},
    "bored": {"zh": "无聊的", "ipa": "/bɔːrd/", "emoji": "🥱", "track": "phonics", "type": "r_controlled"},
    "box": {"zh": "盒子", "ipa": "/bɒks/", "emoji": "📦", "track": "phonics", "type": "cvc"},
    "brush": {"zh": "刷子，画笔", "ipa": "/brʌʃ/", "emoji": "🖌️", "track": "phonics", "type": "blend"},
    "bunch": {"zh": "一束，一串", "ipa": "/bʌntʃ/", "emoji": "💐", "track": "phonics", "type": "blend"},
    "bus": {"zh": "公交车", "ipa": "/bʌs/", "emoji": "🚌", "track": "phonics", "type": "cvc"},
    "but": {"zh": "但是", "ipa": "/bʌt/", "emoji": "⚠️", "track": "phonics", "type": "cvc"},
    "butter": {"zh": "黄油", "ipa": "/ˈbʌtər/", "emoji": "🧈", "track": "phonics", "type": "other"},
    "call": {"zh": "呼喊，打电话", "ipa": "/kɔːl/", "emoji": "📞", "track": "phonics", "type": "other"},
    "can": {"zh": "能，可以", "ipa": "/kæn/", "emoji": "💪", "track": "phonics", "type": "cvc"},
    "car": {"zh": "小汽车", "ipa": "/kɑːr/", "emoji": "🚗", "track": "phonics", "type": "r_controlled"},
    "card": {"zh": "卡片", "ipa": "/kɑːrd/", "emoji": "🃏", "track": "phonics", "type": "r_controlled"},
    "cat": {"zh": "猫", "ipa": "/kæt/", "emoji": "🐱", "track": "phonics", "type": "cvc"},
    "chicken": {"zh": "小鸡，鸡肉", "ipa": "/ˈtʃɪkɪn/", "emoji": "🍗", "track": "phonics", "type": "other"},
    "chip": {"zh": "奇普 (主角)", "ipa": "/tʃɪp/", "emoji": "👦", "track": "sight", "type": "name"},
    "chocolates": {"zh": "巧克力", "ipa": "/ˈtʃɒklɪts/", "emoji": "🍫", "track": "phonics", "type": "other"},
    "cold": {"zh": "寒冷的", "ipa": "/koʊld/", "emoji": "🥶", "track": "phonics", "type": "blend"},
    "come": {"zh": "来", "ipa": "/kʌm/", "emoji": "👋", "track": "sight", "type": "high_frequency"},
    "comic": {"zh": "连环画，漫画", "ipa": "/ˈkɒmɪk/", "emoji": "📖", "track": "phonics", "type": "other"},
    "coming": {"zh": "正在来", "ipa": "/ˈkʌmɪŋ/", "emoji": "🚶", "track": "sight", "type": "high_frequency"},
    "crash": {"zh": "撞击，哗啦声", "ipa": "/kræʃ/", "emoji": "💥", "track": "phonics", "type": "blend"},
    "cream": {"zh": "奶油", "ipa": "/kriːm/", "emoji": "🍦", "track": "phonics", "type": "vowel_digraph"},
    "crisps": {"zh": "薯片", "ipa": "/krɪsps/", "emoji": "🥔", "track": "phonics", "type": "blend"},
    "cross": {"zh": "生气的", "ipa": "/krɒs/", "emoji": "😠", "track": "phonics", "type": "blend"},
    "dad": {"zh": "爸爸", "ipa": "/dæd/", "emoji": "👨", "track": "phonics", "type": "cvc"},
    "day": {"zh": "一天，白昼", "ipa": "/deɪ/", "emoji": "☀️", "track": "phonics", "type": "vowel_digraph"},
    "diary": {"zh": "日记", "ipa": "/ˈdaɪəri/", "emoji": "📔", "track": "phonics", "type": "other"},
    "did": {"zh": "做了", "ipa": "/dɪd/", "emoji": "✔️", "track": "phonics", "type": "cvc"},
    "din": {"zh": "喧闹声", "ipa": "/dɪn/", "emoji": "📢", "track": "phonics", "type": "cvc"},
    "dinosaur": {"zh": "恐龙", "ipa": "/ˈdaɪnəsɔːr/", "emoji": "🦖", "track": "phonics", "type": "other"},
    "do": {"zh": "做", "ipa": "/duː/", "emoji": "🎯", "track": "sight", "type": "high_frequency"},
    "dog": {"zh": "狗", "ipa": "/dɒɡ/", "emoji": "🐶", "track": "phonics", "type": "cvc"},
    "dogs": {"zh": "小狗们", "ipa": "/dɒɡz/", "emoji": "🐕", "track": "phonics", "type": "cvc"},
    "dress": {"zh": "连衣裙，装扮", "ipa": "/drɛs/", "emoji": "👗", "track": "phonics", "type": "blend"},
    "drum": {"zh": "鼓", "ipa": "/drʌm/", "emoji": "🥁", "track": "phonics", "type": "blend"},
    "eggs": {"zh": "鸡蛋", "ipa": "/ɛɡz/", "emoji": "🥚", "track": "phonics", "type": "other"},
    "every": {"zh": "每一个", "ipa": "/ˈɛvri/", "emoji": "👥", "track": "sight", "type": "high_frequency"},
    "everyone": {"zh": "大家，每个人", "ipa": "/ˈɛvriwʌn/", "emoji": "👨‍👩‍👧‍👦", "track": "sight", "type": "high_frequency"},
    "eyebrows": {"zh": "眉毛", "ipa": "/ˈaɪbraʊz/", "emoji": "🤨", "track": "phonics", "type": "compound"},
    "faces": {"zh": "脸，鬼脸", "ipa": "/ˈfeɪsɪz/", "emoji": "😀", "track": "phonics", "type": "magic_e"},
    "fancy": {"zh": "奇特的，化装", "ipa": "/ˈfænsi/", "emoji": "🎭", "track": "phonics", "type": "other"},
    "feet": {"zh": "脚(复数)", "ipa": "/fiːt/", "emoji": "🦶", "track": "phonics", "type": "vowel_digraph"},
    "fierce": {"zh": "凶猛的", "ipa": "/fɪərs/", "emoji": "🐯", "track": "phonics", "type": "r_controlled"},
    "flat": {"zh": "平的", "ipa": "/flæt/", "emoji": "🥞", "track": "phonics", "type": "blend"},
    "floppy": {"zh": "弗洛皮 (小狗主角)", "ipa": "/ˈflɒpi/", "emoji": "🐶", "track": "sight", "type": "name"},
    "flour": {"zh": "面粉", "ipa": "/flaʊər/", "emoji": "🌾", "track": "phonics", "type": "vowel_digraph"},
    "flower": {"zh": "花", "ipa": "/ˈflaʊər/", "emoji": "🌸", "track": "phonics", "type": "vowel_digraph"},
    "flowers": {"zh": "花儿", "ipa": "/ˈflaʊərz/", "emoji": "💐", "track": "phonics", "type": "vowel_digraph"},
    "for": {"zh": "为了，给", "ipa": "/fɔːr/", "emoji": "🎁", "track": "sight", "type": "r_controlled"},
    "forgot": {"zh": "忘记了", "ipa": "/fərˈɡɒt/", "emoji": "❓", "track": "phonics", "type": "other"},
    "friday": {"zh": "星期五", "ipa": "/ˈfraɪdeɪ/", "emoji": "📅", "track": "phonics", "type": "compound"},
    "frightened": {"zh": "害怕的", "ipa": "/ˈfraɪtənd/", "emoji": "😨", "track": "phonics", "type": "other"},
    "frog": {"zh": "青蛙", "ipa": "/frɒɡ/", "emoji": "🐸", "track": "phonics", "type": "blend"},
    "frying": {"zh": "油煎", "ipa": "/ˈfraɪɪŋ/", "emoji": "🍳", "track": "phonics", "type": "blend"},
    "fun": {"zh": "有趣的，乐趣", "ipa": "/fʌn/", "emoji": "🎉", "track": "phonics", "type": "cvc"},
    "get": {"zh": "得到，到达", "ipa": "/ɡɛt/", "emoji": "✊", "track": "phonics", "type": "cvc"},
    "giant": {"zh": "巨人", "ipa": "/ˈdʒaɪənt/", "emoji": "🧌", "track": "phonics", "type": "other"},
    "go": {"zh": "去，走", "ipa": "/ɡoʊ/", "emoji": "🚀", "track": "sight", "type": "high_frequency"},
    "goal": {"zh": "球门，进球", "ipa": "/ɡoʊl/", "emoji": "🥅", "track": "phonics", "type": "vowel_digraph"},
    "going": {"zh": "正要去", "ipa": "/ˈɡoʊɪŋ/", "emoji": "🚶", "track": "sight", "type": "high_frequency"},
    "goldfish": {"zh": "金鱼", "ipa": "/ˈɡoʊldfɪʃ/", "emoji": "🐠", "track": "phonics", "type": "compound"},
    "good": {"zh": "好的", "ipa": "/ɡʊd/", "emoji": "👍", "track": "sight", "type": "high_frequency"},
    "got": {"zh": "得到了", "ipa": "/ɡɒt/", "emoji": "🎁", "track": "phonics", "type": "cvc"},
    "grapes": {"zh": "葡萄", "ipa": "/ɡreɪps/", "emoji": "🍇", "track": "phonics", "type": "magic_e"},
    "guitar": {"zh": "吉他", "ipa": "/ɡɪˈtɑːr/", "emoji": "🎸", "track": "phonics", "type": "other"},
    "had": {"zh": "有(过去式)", "ipa": "/hæd/", "emoji": "🎒", "track": "phonics", "type": "cvc"},
    "hand": {"zh": "手", "ipa": "/hænd/", "emoji": "✋", "track": "phonics", "type": "blend"},
    "happy": {"zh": "快乐的", "ipa": "/ˈhæpi/", "emoji": "😊", "track": "phonics", "type": "other"},
    "has": {"zh": "有", "ipa": "/hæz/", "emoji": "👜", "track": "phonics", "type": "cvc"},
    "hat": {"zh": "帽子", "ipa": "/hæt/", "emoji": "🧢", "track": "phonics", "type": "cvc"},
    "hates": {"zh": "讨厌", "ipa": "/heɪts/", "emoji": "😣", "track": "phonics", "type": "magic_e"},
    "he": {"zh": "他", "ipa": "/hiː/", "emoji": "👦", "track": "sight", "type": "high_frequency"},
    "headache": {"zh": "头疼", "ipa": "/ˈhɛdeɪk/", "emoji": "🤕", "track": "phonics", "type": "compound"},
    "hide": {"zh": "躲藏", "ipa": "/haɪd/", "emoji": "🙈", "track": "phonics", "type": "magic_e"},
    "ho": {"zh": "呵！(感叹词)", "ipa": "/hoʊ/", "emoji": "😮", "track": "sight", "type": "other"},
    "hooray": {"zh": "好哇！万岁！", "ipa": "/hʊˈreɪ/", "emoji": "🙌", "track": "sight", "type": "other"},
    "horse": {"zh": "马", "ipa": "/hɔːrs/", "emoji": "🐴", "track": "phonics", "type": "r_controlled"},
    "hot": {"zh": "热的", "ipa": "/hɒt/", "emoji": "🔥", "track": "phonics", "type": "cvc"},
    "hungry": {"zh": "饥饿的", "ipa": "/ˈhʌŋɡri/", "emoji": "🤤", "track": "phonics", "type": "other"},
    "i": {"zh": "我", "ipa": "/aɪ/", "emoji": "🙋‍♂️", "track": "sight", "type": "high_frequency"},
    "i'm": {"zh": "我是", "ipa": "/aɪm/", "emoji": "🙋", "track": "sight", "type": "high_frequency"},
    "ice": {"zh": "冰", "ipa": "/aɪs/", "emoji": "🧊", "track": "phonics", "type": "magic_e"},
    "if": {"zh": "如果", "ipa": "/ɪf/", "emoji": "💡", "track": "phonics", "type": "cvc"},
    "in": {"zh": "在...里面", "ipa": "/ɪn/", "emoji": "📥", "track": "phonics", "type": "cvc"},
    "is": {"zh": "是", "ipa": "/ɪz/", "emoji": "✨", "track": "phonics", "type": "cvc"},
    "it": {"zh": "它", "ipa": "/ɪt/", "emoji": "👉", "track": "phonics", "type": "cvc"},
    "it's": {"zh": "它是", "ipa": "/ɪts/", "emoji": "👉", "track": "phonics", "type": "cvc"},
    "jam": {"zh": "果酱", "ipa": "/dʒæm/", "emoji": "🍓", "track": "phonics", "type": "cvc"},
    "journey": {"zh": "旅途，旅行", "ipa": "/ˈdʒɜːrni/", "emoji": "🚗", "track": "phonics", "type": "other"},
    "kate": {"zh": "凯特 (人物名)", "ipa": "/keɪt/", "emoji": "👧", "track": "sight", "type": "name"},
    "kipper": {"zh": "基珀 (弟弟主角)", "ipa": "/ˈkɪpər/", "emoji": "👶", "track": "sight", "type": "name"},
    "kipper's": {"zh": "基珀的", "ipa": "/ˈkɪpərz/", "emoji": "👶", "track": "sight", "type": "name"},
    "ladder": {"zh": "梯子", "ipa": "/ˈlædər/", "emoji": "🪜", "track": "phonics", "type": "other"},
    "like": {"zh": "喜欢，像", "ipa": "/laɪk/", "emoji": "❤️", "track": "sight", "type": "magic_e"},
    "likes": {"zh": "喜欢", "ipa": "/laɪks/", "emoji": "❤️", "track": "sight", "type": "magic_e"},
    "little": {"zh": "小的", "ipa": "/ˈlɪtəl/", "emoji": "🐣", "track": "sight", "type": "high_frequency"},
    "look": {"zh": "看", "ipa": "/lʊk/", "emoji": "👀", "track": "sight", "type": "high_frequency"},
    "looking": {"zh": "正在看", "ipa": "/ˈlʊkɪŋ/", "emoji": "🔎", "track": "sight", "type": "high_frequency"},
    "lorry": {"zh": "大卡车", "ipa": "/ˈlɒri/", "emoji": "🚛", "track": "phonics", "type": "other"},
    "lost": {"zh": "迷路了，丢失", "ipa": "/lɒst/", "emoji": "🧭", "track": "phonics", "type": "blend"},
    "made": {"zh": "制作(过去式)", "ipa": "/meɪd/", "emoji": "🛠️", "track": "phonics", "type": "magic_e"},
    "making": {"zh": "正在制作", "ipa": "/ˈmeɪkɪŋ/", "emoji": "✂️", "track": "phonics", "type": "magic_e"},
    "market": {"zh": "集市，市场", "ipa": "/ˈmɑːrkɪt/", "emoji": "🛒", "track": "phonics", "type": "r_controlled"},
    "me": {"zh": "我(宾格)", "ipa": "/miː/", "emoji": "🙋", "track": "sight", "type": "high_frequency"},
    "mess": {"zh": "脏乱，混乱", "ipa": "/mɛs/", "emoji": "🧹", "track": "phonics", "type": "cvc"},
    "milk": {"zh": "牛奶", "ipa": "/mɪlk/", "emoji": "🥛", "track": "phonics", "type": "blend"},
    "miserable": {"zh": "痛苦的，沮丧的", "ipa": "/ˈmɪzərəbəl/", "emoji": "😢", "track": "phonics", "type": "other"},
    "mix": {"zh": "搅拌，混合", "ipa": "/mɪks/", "emoji": "🥣", "track": "phonics", "type": "cvc"},
    "monday": {"zh": "星期一", "ipa": "/ˈmʌndeɪ/", "emoji": "📅", "track": "phonics", "type": "compound"},
    "monster": {"zh": "怪物", "ipa": "/ˈmɒnstər/", "emoji": "👾", "track": "phonics", "type": "other"},
    "mud": {"zh": "泥巴", "ipa": "/mʌd/", "emoji": "🪵", "track": "phonics", "type": "cvc"},
    "muddy": {"zh": "沾满泥巴的", "ipa": "/ˈmʌdi/", "emoji": "🐾", "track": "phonics", "type": "other"},
    "mum": {"zh": "妈妈", "ipa": "/mʌm/", "emoji": "👩", "track": "phonics", "type": "cvc"},
    "my": {"zh": "我的", "ipa": "/maɪ/", "emoji": "🏷️", "track": "sight", "type": "high_frequency"},
    "net": {"zh": "网", "ipa": "/nɛt/", "emoji": "🥅", "track": "phonics", "type": "cvc"},
    "no": {"zh": "不", "ipa": "/noʊ/", "emoji": "❌", "track": "sight", "type": "high_frequency"},
    "nose": {"zh": "鼻子", "ipa": "/noʊz/", "emoji": "👃", "track": "phonics", "type": "magic_e"},
    "not": {"zh": "不是", "ipa": "/nɒt/", "emoji": "🚫", "track": "phonics", "type": "cvc"},
    "of": {"zh": "...的", "ipa": "/əv/", "emoji": "🔗", "track": "sight", "type": "high_frequency"},
    "oh": {"zh": "哦！", "ipa": "/oʊ/", "emoji": "😲", "track": "sight", "type": "high_frequency"},
    "old": {"zh": "年老的，旧的", "ipa": "/oʊld/", "emoji": "👴", "track": "sight", "type": "high_frequency"},
    "on": {"zh": "在...上面", "ipa": "/ɒn/", "emoji": "🔛", "track": "phonics", "type": "cvc"},
    "one": {"zh": "一", "ipa": "/wʌn/", "emoji": "1️⃣", "track": "sight", "type": "high_frequency"},
    "out": {"zh": "出来，在外面", "ipa": "/aʊt/", "emoji": "🚪", "track": "phonics", "type": "vowel_digraph"},
    "painting": {"zh": "画画，绘画", "ipa": "/ˈpeɪntɪŋ/", "emoji": "🎨", "track": "phonics", "type": "vowel_digraph"},
    "pan": {"zh": "平底锅", "ipa": "/pæn/", "emoji": "🍳", "track": "phonics", "type": "cvc"},
    "pancake": {"zh": "薄煎饼", "ipa": "/ˈpænkeɪk/", "emoji": "🥞", "track": "phonics", "type": "compound"},
    "park": {"zh": "公园", "ipa": "/pɑːrk/", "emoji": "🏞️", "track": "phonics", "type": "r_controlled"},
    "pat": {"zh": "轻拍", "ipa": "/pæt/", "emoji": "✋", "track": "phonics", "type": "cvc"},
    "pet": {"zh": "宠物", "ipa": "/pɛt/", "emoji": "🐾", "track": "phonics", "type": "cvc"},
    "picture": {"zh": "图片，画", "ipa": "/ˈpɪktʃər/", "emoji": "🖼️", "track": "phonics", "type": "other"},
    "pie": {"zh": "派，馅饼", "ipa": "/paɪ/", "emoji": "🥧", "track": "phonics", "type": "vowel_digraph"},
    "pillow": {"zh": "枕头", "ipa": "/ˈpɪloʊ/", "emoji": "🛏️", "track": "phonics", "type": "other"},
    "pirate": {"zh": "海盗", "ipa": "/ˈpaɪrət/", "emoji": "🏴‍☠️", "track": "phonics", "type": "other"},
    "play": {"zh": "玩耍", "ipa": "/pleɪ/", "emoji": "🎮", "track": "phonics", "type": "vowel_digraph"},
    "pool": {"zh": "水池，游泳池", "ipa": "/puːl/", "emoji": "🏊", "track": "phonics", "type": "vowel_digraph"},
    "pot": {"zh": "锅", "ipa": "/pɒt/", "emoji": "🍲", "track": "phonics", "type": "cvc"},
    "presents": {"zh": "礼物", "ipa": "/ˈprɛzənts/", "emoji": "🎁", "track": "phonics", "type": "blend"},
    "pulled": {"zh": "拉，拔", "ipa": "/pʊld/", "emoji": "🧗", "track": "phonics", "type": "other"},
    "push": {"zh": "推", "ipa": "/pʊʃ/", "emoji": "🫸", "track": "phonics", "type": "other"},
    "pushed": {"zh": "推了", "ipa": "/pʊʃt/", "emoji": "🫸", "track": "phonics", "type": "other"},
    "put": {"zh": "放", "ipa": "/pʊt/", "emoji": "📥", "track": "sight", "type": "high_frequency"},
    "race": {"zh": "比赛", "ipa": "/reɪs/", "emoji": "🏁", "track": "phonics", "type": "magic_e"},
    "rat": {"zh": "老鼠", "ipa": "/ræt/", "emoji": "🐀", "track": "phonics", "type": "cvc"},
    "recorder": {"zh": "竖笛，录音机", "ipa": "/rɪˈkɔːrdər/", "emoji": "🪈", "track": "phonics", "type": "r_controlled"},
    "red": {"zh": "红色的", "ipa": "/rɛd/", "emoji": "🔴", "track": "phonics", "type": "cvc"},
    "reds": {"zh": "红队，红色", "ipa": "/rɛdz/", "emoji": "🟥", "track": "phonics", "type": "cvc"},
    "ring": {"zh": "戒指，响铃", "ipa": "/rɪŋ/", "emoji": "💍", "track": "phonics", "type": "blend"},
    "rug": {"zh": "小地毯", "ipa": "/rʌɡ/", "emoji": "🧶", "track": "phonics", "type": "cvc"},
    "run": {"zh": "跑", "ipa": "/rʌn/", "emoji": "🏃", "track": "phonics", "type": "cvc"},
    "sad": {"zh": "伤心的", "ipa": "/sæd/", "emoji": "😢", "track": "phonics", "type": "cvc"},
    "said": {"zh": "说(过去式)", "ipa": "/sɛd/", "emoji": "💬", "track": "sight", "type": "high_frequency"},
    "sand": {"zh": "沙子", "ipa": "/sænd/", "emoji": "🏖️", "track": "phonics", "type": "blend"},
    "saw": {"zh": "看见(过去式)", "ipa": "/sɔː/", "emoji": "👁️", "track": "phonics", "type": "vowel_digraph"},
    "say": {"zh": "说", "ipa": "/seɪ/", "emoji": "🗣️", "track": "phonics", "type": "vowel_digraph"},
    "scarecrow": {"zh": "稻草人", "ipa": "/ˈskɛərkroʊ/", "emoji": "🌾", "track": "phonics", "type": "compound"},
    "scarf": {"zh": "围巾", "ipa": "/skɑːrf/", "emoji": "🧣", "track": "phonics", "type": "r_controlled"},
    "see": {"zh": "看见", "ipa": "/siː/", "emoji": "👀", "track": "sight", "type": "vowel_digraph"},
    "seek": {"zh": "寻找", "ipa": "/siːk/", "emoji": "🔍", "track": "phonics", "type": "vowel_digraph"},
    "she": {"zh": "她", "ipa": "/ʃiː/", "emoji": "👧", "track": "sight", "type": "high_frequency"},
    "sheet": {"zh": "床单，被单", "ipa": "/ʃiːt/", "emoji": "🛏️", "track": "phonics", "type": "vowel_digraph"},
    "shop": {"zh": "商店", "ipa": "/ʃɒp/", "emoji": "🏪", "track": "phonics", "type": "cvc"},
    "shopping": {"zh": "购物", "ipa": "/ˈʃɒpɪŋ/", "emoji": "🛍️", "track": "phonics", "type": "cvc"},
    "shops": {"zh": "商店(复数)", "ipa": "/ʃɒps/", "emoji": "🏬", "track": "phonics", "type": "cvc"},
    "sit": {"zh": "坐", "ipa": "/sɪt/", "emoji": "🪑", "track": "phonics", "type": "cvc"},
    "six": {"zh": "六", "ipa": "/sɪks/", "emoji": "6️⃣", "track": "phonics", "type": "cvc"},
    "skip": {"zh": "跳跃，跳绳", "ipa": "/skɪp/", "emoji": "🦘", "track": "phonics", "type": "blend"},
    "skipping": {"zh": "正在跳绳", "ipa": "/ˈskɪpɪŋ/", "emoji": "🏃‍♀️", "track": "phonics", "type": "blend"},
    "sleep": {"zh": "睡觉", "ipa": "/sliːp/", "emoji": "😴", "track": "phonics", "type": "vowel_digraph"},
    "slide": {"zh": "滑梯", "ipa": "/slaɪd/", "emoji": "🛝", "track": "phonics", "type": "magic_e"},
    "snake": {"zh": "蛇", "ipa": "/sneɪk/", "emoji": "🐍", "track": "phonics", "type": "magic_e"},
    "some": {"zh": "一些", "ipa": "/sʌm/", "emoji": "✨", "track": "sight", "type": "high_frequency"},
    "sorry": {"zh": "抱歉", "ipa": "/ˈsɒri/", "emoji": "🙇", "track": "phonics", "type": "other"},
    "spaceman": {"zh": "宇航员，太空人", "ipa": "/ˈspeɪsmæn/", "emoji": "👨‍🚀", "track": "phonics", "type": "compound"},
    "spider": {"zh": "蜘蛛", "ipa": "/ˈspaɪdər/", "emoji": "🕷️", "track": "phonics", "type": "other"},
    "splat": {"zh": "啪嗒一声", "ipa": "/splæt/", "emoji": "💥", "track": "phonics", "type": "blend"},
    "stay": {"zh": "留下，待着", "ipa": "/steɪ/", "emoji": "🛑", "track": "phonics", "type": "vowel_digraph"},
    "stuck": {"zh": "卡住了", "ipa": "/stʌk/", "emoji": "🪤", "track": "phonics", "type": "blend"},
    "sugar": {"zh": "糖", "ipa": "/ˈʃʊɡər/", "emoji": "🍬", "track": "phonics", "type": "other"},
    "sunny": {"zh": "阳光明媚的", "ipa": "/ˈsʌni/", "emoji": "☀️", "track": "phonics", "type": "other"},
    "supermarket": {"zh": "超级市场", "ipa": "/ˈsuːpərmɑːrkɪt/", "emoji": "🏬", "track": "phonics", "type": "compound"},
    "swing": {"zh": "秋千", "ipa": "/swɪŋ/", "emoji": "🎠", "track": "phonics", "type": "blend"},
    "teddy": {"zh": "泰迪熊", "ipa": "/ˈtɛdi/", "emoji": "🧸", "track": "phonics", "type": "other"},
    "that": {"zh": "那个", "ipa": "/ðæt/", "emoji": "👉", "track": "sight", "type": "blend"},
    "that's": {"zh": "那是", "ipa": "/ðæts/", "emoji": "👉", "track": "sight", "type": "blend"},
    "the": {"zh": "这/那(定冠词)", "ipa": "/ðə/", "emoji": "🎯", "track": "sight", "type": "high_frequency"},
    "they": {"zh": "他们", "ipa": "/ðeɪ/", "emoji": "👥", "track": "sight", "type": "high_frequency"},
    "thirsty": {"zh": "口渴的", "ipa": "/ˈθɜːrsti/", "emoji": "🥤", "track": "phonics", "type": "r_controlled"},
    "this": {"zh": "这个", "ipa": "/ðɪs/", "emoji": "👇", "track": "sight", "type": "blend"},
    "thursday": {"zh": "星期四", "ipa": "/ˈθɜːrzdeɪ/", "emoji": "📅", "track": "phonics", "type": "compound"},
    "tiger": {"zh": "老虎", "ipa": "/ˈtaɪɡər/", "emoji": "🐯", "track": "phonics", "type": "other"},
    "tin": {"zh": "罐头，铁罐", "ipa": "/tɪn/", "emoji": "🥫", "track": "phonics", "type": "cvc"},
    "tip": {"zh": "倒掉，顶端", "ipa": "/tɪp/", "emoji": "🫗", "track": "phonics", "type": "cvc"},
    "tired": {"zh": "疲倦的", "ipa": "/ˈtaɪərd/", "emoji": "😫", "track": "phonics", "type": "r_controlled"},
    "to": {"zh": "到，向", "ipa": "/tuː/", "emoji": "➡️", "track": "sight", "type": "high_frequency"},
    "too": {"zh": "也，太", "ipa": "/tuː/", "emoji": "➕", "track": "sight", "type": "high_frequency"},
    "top": {"zh": "顶部，顶尖", "ipa": "/tɒp/", "emoji": "🔝", "track": "phonics", "type": "cvc"},
    "tractor": {"zh": "拖拉机", "ipa": "/ˈtræktər/", "emoji": "🚜", "track": "phonics", "type": "blend"},
    "tree": {"zh": "树", "ipa": "/triː/", "emoji": "🌳", "track": "phonics", "type": "vowel_digraph"},
    "trick": {"zh": "把戏，恶作剧", "ipa": "/trɪk/", "emoji": "🪄", "track": "phonics", "type": "blend"},
    "trumpet": {"zh": "小号，喇叭", "ipa": "/ˈtrʌmpɪt/", "emoji": "🎺", "track": "phonics", "type": "blend"},
    "tuesday": {"zh": "星期二", "ipa": "/ˈtjuːzdeɪ/", "emoji": "📅", "track": "phonics", "type": "compound"},
    "up": {"zh": "向上", "ipa": "/ʌp/", "emoji": "⬆️", "track": "phonics", "type": "cvc"},
    "us": {"zh": "我们(宾格)", "ipa": "/ʌs/", "emoji": "🫂", "track": "phonics", "type": "cvc"},
    "van": {"zh": "厢式货车", "ipa": "/væn/", "emoji": "🚐", "track": "phonics", "type": "cvc"},
    "very": {"zh": "非常", "ipa": "/ˈvɛri/", "emoji": "⭐", "track": "sight", "type": "high_frequency"},
    "walk": {"zh": "步行，散步", "ipa": "/wɔːk/", "emoji": "🚶", "track": "phonics", "type": "other"},
    "want": {"zh": "想要", "ipa": "/wɒnt/", "emoji": "🤲", "track": "sight", "type": "high_frequency"},
    "wanted": {"zh": "想要(过去式)", "ipa": "/ˈwɒntɪd/", "emoji": "💭", "track": "sight", "type": "high_frequency"},
    "was": {"zh": "是(过去式)", "ipa": "/wɒz/", "emoji": "🕰️", "track": "sight", "type": "high_frequency"},
    "wasn't": {"zh": "不是(过去式)", "ipa": "/ˈwɒzənt/", "emoji": "🙅", "track": "sight", "type": "high_frequency"},
    "water": {"zh": "水", "ipa": "/ˈwɔːtər/", "emoji": "💧", "track": "phonics", "type": "other"},
    "way": {"zh": "道路，方式", "ipa": "/weɪ/", "emoji": "🛤️", "track": "phonics", "type": "vowel_digraph"},
    "we": {"zh": "我们", "ipa": "/wiː/", "emoji": "👫", "track": "sight", "type": "high_frequency"},
    "wednesday": {"zh": "星期三", "ipa": "/ˈwɛnzdeɪ/", "emoji": "📅", "track": "phonics", "type": "compound"},
    "went": {"zh": "去了(过去式)", "ipa": "/wɛnt/", "emoji": "👣", "track": "sight", "type": "blend"},
    "wet": {"zh": "湿的", "ipa": "/wɛt/", "emoji": "💦", "track": "phonics", "type": "cvc"},
    "what": {"zh": "什么", "ipa": "/wɒt/", "emoji": "❓", "track": "sight", "type": "high_frequency"},
    "who": {"zh": "谁", "ipa": "/huː/", "emoji": "👤", "track": "sight", "type": "high_frequency"},
    "windy": {"zh": "刮风的", "ipa": "/ˈwɪndi/", "emoji": "💨", "track": "phonics", "type": "blend"},
    "yes": {"zh": "是的", "ipa": "/jɛs/", "emoji": "✅", "track": "phonics", "type": "cvc"},
    "you": {"zh": "你，你们", "ipa": "/juː/", "emoji": "🫵", "track": "sight", "type": "high_frequency"},
}


def build_dianfan_data():
    source_dir = Path(r"C:\Users\maoju\Desktop\典范英语1A\典范英语1A")
    lrc_files = sorted(source_dir.glob("1A-*.lrc"))
    if not lrc_files:
        print("未找到 1A-*.lrc 文件！", source_dir)
        return

    lessons = []
    word_stats = Counter()
    word_lessons = {}
    word_examples = {}

    for fpath in lrc_files:
        fname = fpath.name
        # format: 1A-01 Who is it.lrc
        match = re.match(r"(1A-\d+)\s+(.+)\.lrc", fname)
        if match:
            lesson_id = match.group(1)
            lesson_title = match.group(2)
        else:
            lesson_id = fname[:5]
            lesson_title = fname[6:-4]

        sentences = []
        raw_lines = []
        with open(fpath, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                line = re.sub(r"\[.*?\]", "", line).strip()
                if not line or line.startswith("Lesson") or line == "Good English":
                    continue
                sentences.append(line)
                raw_lines.append(line)

        # Extract tokens for this lesson
        lesson_words = set()
        for sent in sentences:
            tokens = re.findall(r"[a-zA-Z]+(?:'[a-zA-Z]+)?", sent)
            for tok in tokens:
                w = tok.lower()
                word_stats[w] += 1
                lesson_words.add(w)
                if w not in word_examples:
                    word_examples[w] = sent

        for w in lesson_words:
            word_lessons.setdefault(w, []).append(lesson_id)

        lessons.append({
            "id": lesson_id,
            "title": lesson_title,
            "sentences": sentences,
            "wordCount": len(lesson_words),
            "words": sorted(lesson_words)
        })

    # Build word list
    words_list = []
    for word, count in word_stats.most_common():
        meta = WORDS_META.get(word, {
            "zh": "英语词汇",
            "ipa": f"/{word}/",
            "emoji": "📖",
            "track": "phonics",
            "type": "other"
        })
        words_list.append({
            "word": word,
            "count": count,
            "lessons": word_lessons.get(word, []),
            "example": word_examples.get(word, ""),
            "zh": meta["zh"],
            "ipa": meta["ipa"],
            "emoji": meta["emoji"],
            "track": meta["track"],
            "phonicsType": meta["type"],
            "isRole": meta["type"] == "name"
        })

    print(f"解析完成: {len(lessons)} 课，共计 {len(words_list)} 个独立词汇。")

    # Save to data/
    out_words_json = Path("data/dianfan_1a_words.json")
    out_lessons_json = Path("data/dianfan_1a_lessons.json")
    out_ts = Path("src/data/dianfan-data.ts")

    with open(out_words_json, "w", encoding="utf-8") as f:
        json.dump(words_list, f, ensure_ascii=False, indent=2)

    with open(out_lessons_json, "w", encoding="utf-8") as f:
        json.dump(lessons, f, ensure_ascii=False, indent=2)

    # Generate TypeScript file for direct import
    ts_code = f"""// Auto-generated Dianfan English 1A (牛津阅读树 1A) dataset
export interface DianfanWord {{
  word: string;
  count: number;
  lessons: string[];
  example: string;
  zh: string;
  ipa: string;
  emoji: string;
  track: 'phonics' | 'sight';
  phonicsType: string;
  isRole: boolean;
}}

export interface DianfanLesson {{
  id: string;
  title: string;
  sentences: string[];
  wordCount: number;
  words: string[];
}}

export const DIANFAN_WORDS: DianfanWord[] = {json.dumps(words_list, ensure_ascii=False, indent=2)};

export const DIANFAN_LESSONS: DianfanLesson[] = {json.dumps(lessons, ensure_ascii=False, indent=2)};
"""
    with open(out_ts, "w", encoding="utf-8") as f:
        f.write(ts_code)

    print("已成功写入:", out_words_json, out_lessons_json, out_ts)

if __name__ == "__main__":
    build_dianfan_data()
