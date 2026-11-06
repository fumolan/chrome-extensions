package com.gientech.wordcatcher;

import org.jetbrains.annotations.Nullable;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 本地词根 / 词缀拆解（离线，无网络请求）。
 * 内置常见前缀、词根、后缀的中文含义表，对单词做保守拆解：
 * 最多剥 1 个前缀 + 1 个后缀，再标注主干中包含的词根。
 * 宁可少拆不可错拆：主干太短、只差屈折变化（-ing/-ed/-s）一律不拆。
 */
public final class RootAnalyzer {

    private RootAnalyzer() {
    }

    // ---------- 前缀表（按长度优先匹配） ----------
    private static final Map<String, String> PREFIXES = new LinkedHashMap<>();

    static {
        PREFIXES.put("counter", "相反");
        PREFIXES.put("circum", "环绕");
        PREFIXES.put("contra", "反对");
        PREFIXES.put("extra", "超出");
        PREFIXES.put("hyper", "过度");
        PREFIXES.put("hypo", "低于");
        PREFIXES.put("inter", "之间");
        PREFIXES.put("intra", "内部");
        PREFIXES.put("intro", "向内");
        PREFIXES.put("multi", "多");
        PREFIXES.put("omni", "全部");
        PREFIXES.put("para", "旁边");
        PREFIXES.put("peri", "周围");
        PREFIXES.put("poly", "多");
        PREFIXES.put("post", "之后");
        PREFIXES.put("pseudo", "假");
        PREFIXES.put("retro", "向后");
        PREFIXES.put("semi", "半");
        PREFIXES.put("super", "超过");
        PREFIXES.put("supra", "之上");
        PREFIXES.put("tele", "远");
        PREFIXES.put("trans", "横过");
        PREFIXES.put("ultra", "极端");
        PREFIXES.put("anti", "反对");
        PREFIXES.put("auto", "自动");
        PREFIXES.put("down", "向下");
        PREFIXES.put("fore", "前面");
        PREFIXES.put("micro", "微小");
        PREFIXES.put("mis", "错误");
        PREFIXES.put("mono", "单一");
        PREFIXES.put("neo", "新");
        PREFIXES.put("over", "过度");
        PREFIXES.put("proto", "原始");
        PREFIXES.put("sub", "下面");
        PREFIXES.put("sur", "在上");
        PREFIXES.put("sym", "共同");
        PREFIXES.put("syn", "共同");
        PREFIXES.put("tri", "三");
        PREFIXES.put("uni", "单一");
        // 2 字符前缀只保留误拆率低的 un / re / de；
        // in / im / en / ex / bi / co 等误拆率过高（input、entire、context），不收录
        PREFIXES.put("de", "去除");
        PREFIXES.put("dis", "不");
        PREFIXES.put("mal", "坏");
        PREFIXES.put("non", "非");
        PREFIXES.put("ob", "逆向");
        PREFIXES.put("out", "超出");
        PREFIXES.put("per", "贯穿");
        PREFIXES.put("pre", "预先");
        PREFIXES.put("pro", "向前");
        PREFIXES.put("re", "再次");
        PREFIXES.put("un", "不");
    }

    // ---------- 后缀表（按长度优先匹配；-ing/-ed/-s 等屈折变化不拆） ----------
    private static final Map<String, String> SUFFIXES = new LinkedHashMap<>();

    static {
        SUFFIXES.put("ization", "…化");
        SUFFIXES.put("ation", "行为/结果");
        SUFFIXES.put("ition", "行为/结果");
        SUFFIXES.put("ution", "行为/结果");
        SUFFIXES.put("ology", "学科");
        SUFFIXES.put("ography", "记录学");
        SUFFIXES.put("cracy", "统治");
        SUFFIXES.put("crat", "统治者");
        SUFFIXES.put("arium", "场所");
        SUFFIXES.put("orium", "场所");
        SUFFIXES.put("escence", "过程");
        SUFFIXES.put("itude", "状态");
        SUFFIXES.put("ance", "状态");
        SUFFIXES.put("ence", "状态");
        SUFFIXES.put("ancy", "状态");
        SUFFIXES.put("ency", "状态");
        SUFFIXES.put("able", "可…的");
        SUFFIXES.put("ible", "可…的");
        SUFFIXES.put("ical", "…的");
        SUFFIXES.put("ious", "充满…的");
        SUFFIXES.put("eous", "…的");
        SUFFIXES.put("ment", "行为/结果");
        SUFFIXES.put("tion", "行为/结果");
        SUFFIXES.put("sion", "行为/结果");
        SUFFIXES.put("ship", "身份/状态");
        SUFFIXES.put("hood", "时期/身份");
        SUFFIXES.put("ness", "性质");
        SUFFIXES.put("less", "没有…的");
        SUFFIXES.put("ful", "充满…的");
        SUFFIXES.put("ify", "使…化");
        SUFFIXES.put("ize", "使…化");
        SUFFIXES.put("ise", "使…化");
        SUFFIXES.put("ate", "使");
        SUFFIXES.put("ism", "主义");
        SUFFIXES.put("ist", "…者");
        SUFFIXES.put("ity", "性质");
        SUFFIXES.put("ive", "有…性质的");
        SUFFIXES.put("ous", "…的");
        SUFFIXES.put("ant", "…的/人");
        SUFFIXES.put("ent", "…的/人");
        SUFFIXES.put("ary", "场所/…的");
        SUFFIXES.put("ory", "场所");
        SUFFIXES.put("ery", "场所/行为");
        SUFFIXES.put("ure", "行为/结果");
        SUFFIXES.put("ian", "…人");
        SUFFIXES.put("ese", "…人/语");
        SUFFIXES.put("ess", "女性");
        SUFFIXES.put("let", "小");
        SUFFIXES.put("oid", "…状的");
        SUFFIXES.put("dom", "状态/领域");
        SUFFIXES.put("cide", "杀");
        SUFFIXES.put("logy", "学科");
        SUFFIXES.put("acy", "性质");
        SUFFIXES.put("cy", "性质");
        SUFFIXES.put("al", "…的");
        SUFFIXES.put("ic", "…的");
        SUFFIXES.put("id", "…的");
        SUFFIXES.put("ile", "…的");
        SUFFIXES.put("ine", "…的");
        SUFFIXES.put("ish", "…的");
        SUFFIXES.put("ty", "性质");
        SUFFIXES.put("fy", "使");
        SUFFIXES.put("er", "做…的人");
        SUFFIXES.put("or", "做…的人");
        SUFFIXES.put("ly", "…地");
        // 不收录 -age（manage→man+age 之类误拆严重）、-y（信息量低）
    }

    // ---------- 常见词根表 ----------
    private static final Map<String, String> ROOTS = new LinkedHashMap<>();

    static {
        ROOTS.put("act", "做/行动");
        ROOTS.put("ag", "做/驱动");
        ROOTS.put("agr", "田地");
        ROOTS.put("alter", "改变");
        ROOTS.put("am", "爱");
        ROOTS.put("anim", "生命/精神");
        ROOTS.put("ann", "年");
        ROOTS.put("apt", "适合");
        ROOTS.put("aqu", "水");
        ROOTS.put("arch", "统治");
        ROOTS.put("aud", "听");
        ROOTS.put("aug", "增加");
        ROOTS.put("auth", "创造者");
        ROOTS.put("auto", "自身");
        ROOTS.put("bell", "战争");
        ROOTS.put("bene", "善");
        ROOTS.put("bio", "生命");
        ROOTS.put("brev", "短");
        ROOTS.put("cad", "落下");
        ROOTS.put("cap", "抓取/容纳");
        ROOTS.put("capt", "抓取");
        ROOTS.put("cept", "拿取");
        ROOTS.put("cess", "行走");
        ROOTS.put("cid", "落/切");
        ROOTS.put("cip", "取");
        ROOTS.put("circ", "环");
        ROOTS.put("claim", "呼喊");
        ROOTS.put("clar", "清楚");
        ROOTS.put("clin", "倾斜");
        ROOTS.put("clos", "关闭");
        ROOTS.put("cogn", "知道");
        ROOTS.put("cord", "心");
        ROOTS.put("corp", "身体");
        ROOTS.put("cosm", "宇宙");
        ROOTS.put("cre", "制造");
        ROOTS.put("cred", "相信");
        ROOTS.put("curr", "跑");
        ROOTS.put("curs", "跑");
        ROOTS.put("cur", "关心/跑");
        ROOTS.put("deb", "欠");
        ROOTS.put("dens", "浓密");
        ROOTS.put("dent", "牙齿");
        ROOTS.put("derm", "皮肤");
        ROOTS.put("dict", "说");
        ROOTS.put("divid", "分开");
        ROOTS.put("doc", "教");
        ROOTS.put("dom", "驯服");
        ROOTS.put("don", "给予");
        ROOTS.put("dor", "给予");
        ROOTS.put("duct", "引导");
        ROOTS.put("dur", "持久");
        ROOTS.put("dyn", "力量");
        ROOTS.put("equ", "相等");
        ROOTS.put("erg", "工作/能量");
        ROOTS.put("err", "漫游/错");
        ROOTS.put("fac", "做");
        ROOTS.put("fact", "做");
        ROOTS.put("fall", "欺骗");
        ROOTS.put("fam", "名声");
        ROOTS.put("fer", "带来");
        ROOTS.put("fess", "说");
        ROOTS.put("fid", "信任");
        ROOTS.put("fig", "塑造");
        ROOTS.put("fin", "结束/界限");
        ROOTS.put("flect", "弯曲");
        ROOTS.put("flex", "弯曲");
        ROOTS.put("flu", "流动");
        ROOTS.put("form", "形状");
        ROOTS.put("fort", "强");
        ROOTS.put("found", "倾倒");
        ROOTS.put("fract", "破碎");
        ROOTS.put("frag", "破碎");
        ROOTS.put("fus", "倾倒");
        ROOTS.put("gam", "婚姻");
        ROOTS.put("gen", "出生/产生");
        ROOTS.put("geo", "地球");
        ROOTS.put("ger", "携带");
        ROOTS.put("gest", "携带");
        ROOTS.put("grad", "步/级");
        ROOTS.put("gram", "书写");
        ROOTS.put("graph", "书写");
        ROOTS.put("grat", "感谢");
        ROOTS.put("grav", "重");
        ROOTS.put("greg", "群");
        ROOTS.put("gress", "行走");
        ROOTS.put("helio", "太阳");
        ROOTS.put("her", "粘附");
        ROOTS.put("hibit", "持有");
        ROOTS.put("homo", "相同");
        ROOTS.put("hydr", "水");
        ROOTS.put("ign", "火");
        ROOTS.put("integr", "完整");
        ROOTS.put("iso", "相等");
        ROOTS.put("ject", "投掷");
        ROOTS.put("jud", "判断");
        ROOTS.put("junct", "连接");
        ROOTS.put("jur", "法律/发誓");
        ROOTS.put("just", "正义");
        ROOTS.put("labor", "劳动");
        ROOTS.put("lat", "携带");
        ROOTS.put("later", "边");
        ROOTS.put("lect", "选择/读");
        ROOTS.put("leg", "法律");
        ROOTS.put("lev", "轻/举起");
        ROOTS.put("liber", "自由");
        ROOTS.put("libr", "书");
        ROOTS.put("lic", "允许");
        ROOTS.put("lig", "绑");
        ROOTS.put("lingu", "语言");
        ROOTS.put("liter", "文字");
        ROOTS.put("loc", "地方");
        ROOTS.put("log", "言语/学问");
        ROOTS.put("loqu", "说话");
        ROOTS.put("luc", "光");
        ROOTS.put("lum", "光");
        ROOTS.put("lun", "月亮");
        ROOTS.put("magn", "大");
        ROOTS.put("man", "手");
        ROOTS.put("mand", "命令");
        ROOTS.put("mar", "海");
        ROOTS.put("mater", "母亲");
        ROOTS.put("medi", "中间");
        ROOTS.put("mem", "记忆");
        ROOTS.put("ment", "心智");
        ROOTS.put("merc", "贸易");
        ROOTS.put("merg", "沉/合并");
        ROOTS.put("meter", "测量");
        ROOTS.put("metr", "测量");
        ROOTS.put("migr", "迁移");
        ROOTS.put("min", "小");
        ROOTS.put("miss", "送");
        ROOTS.put("mit", "送");
        ROOTS.put("mob", "移动");
        ROOTS.put("mod", "方式");
        ROOTS.put("mon", "警告");
        ROOTS.put("mort", "死");
        ROOTS.put("mot", "移动");
        ROOTS.put("mount", "攀登");
        ROOTS.put("mus", "娱乐");
        ROOTS.put("nat", "出生");
        ROOTS.put("nav", "船");
        ROOTS.put("nect", "绑");
        ROOTS.put("neur", "神经");
        ROOTS.put("nihil", "无");
        ROOTS.put("nomin", "名称");
        ROOTS.put("norm", "标准");
        ROOTS.put("not", "标记");
        ROOTS.put("nov", "新");
        ROOTS.put("numer", "数");
        ROOTS.put("oper", "工作");
        ROOTS.put("opt", "选择/最佳");
        ROOTS.put("ora", "说/口");
        ROOTS.put("ord", "顺序");
        ROOTS.put("organ", "工具");
        ROOTS.put("pac", "和平");
        ROOTS.put("pan", "全");
        ROOTS.put("par", "相等");
        ROOTS.put("pass", "通过/感情");
        ROOTS.put("path", "感情/疾病");
        ROOTS.put("patr", "父亲");
        ROOTS.put("ped", "脚");
        ROOTS.put("pel", "推");
        ROOTS.put("pen", "惩罚");
        ROOTS.put("pend", "悬挂");
        ROOTS.put("pet", "寻求");
        ROOTS.put("phon", "声音");
        ROOTS.put("phot", "光");
        ROOTS.put("pict", "描绘");
        ROOTS.put("plen", "满");
        ROOTS.put("plic", "折叠");
        ROOTS.put("ply", "折叠");
        ROOTS.put("polit", "城市");
        ROOTS.put("pon", "放置");
        ROOTS.put("port", "搬运");
        ROOTS.put("pos", "放置");
        ROOTS.put("pot", "能力");
        ROOTS.put("prec", "祈祷");
        ROOTS.put("press", "压");
        ROOTS.put("prim", "第一");
        ROOTS.put("pris", "抓住");
        ROOTS.put("priv", "私有");
        ROOTS.put("proach", "接近");
        ROOTS.put("prob", "测试");
        ROOTS.put("proper", "自己的");
        ROOTS.put("psych", "心理");
        ROOTS.put("pugn", "打斗");
        ROOTS.put("punct", "刺");
        ROOTS.put("pur", "纯净");
        ROOTS.put("quer", "寻求");
        ROOTS.put("qui", "安静");
        ROOTS.put("quit", "免除");
        ROOTS.put("put", "放置");
        ROOTS.put("radi", "光线");
        ROOTS.put("rap", "抢夺");
        ROOTS.put("rat", "理性");
        ROOTS.put("rect", "直");
        ROOTS.put("reg", "统治/直");
        ROOTS.put("rid", "笑");
        ROOTS.put("rot", "旋转");
        ROOTS.put("rupt", "破裂");
        ROOTS.put("rur", "乡村");
        ROOTS.put("sacr", "神圣");
        ROOTS.put("sal", "盐");
        ROOTS.put("sanct", "神圣");
        ROOTS.put("sat", "满");
        ROOTS.put("scend", "攀爬");
        ROOTS.put("sci", "知道");
        ROOTS.put("scope", "观看");
        ROOTS.put("scrib", "书写");
        ROOTS.put("script", "书写");
        ROOTS.put("sect", "切割");
        ROOTS.put("sed", "坐");
        ROOTS.put("sembl", "类似");
        ROOTS.put("sen", "老");
        ROOTS.put("sens", "感觉");
        ROOTS.put("sent", "感觉");
        ROOTS.put("sequ", "跟随");
        ROOTS.put("sert", "插入");
        ROOTS.put("serv", "服务/保持");
        ROOTS.put("sid", "坐");
        ROOTS.put("sign", "标记");
        ROOTS.put("sim", "相似");
        ROOTS.put("sist", "站立");
        ROOTS.put("soc", "同伴");
        ROOTS.put("sol", "太阳/单独");
        ROOTS.put("somn", "睡眠");
        ROOTS.put("son", "声音");
        ROOTS.put("soph", "智慧");
        ROOTS.put("spec", "看");
        ROOTS.put("spect", "看");
        ROOTS.put("spir", "呼吸");
        ROOTS.put("spond", "承诺");
        ROOTS.put("st", "站立");
        ROOTS.put("sta", "站立");
        ROOTS.put("still", "滴");
        ROOTS.put("struct", "建造");
        ROOTS.put("su", "跟随");
        ROOTS.put("sum", "拿取");
        ROOTS.put("tact", "接触");
        ROOTS.put("tang", "接触");
        ROOTS.put("techn", "技艺");
        ROOTS.put("tect", "遮盖");
        ROOTS.put("temp", "时间");
        ROOTS.put("ten", "持有");
        ROOTS.put("tend", "伸展");
        ROOTS.put("tens", "伸展");
        ROOTS.put("term", "界限");
        ROOTS.put("terr", "土地");
        ROOTS.put("test", "见证");
        ROOTS.put("text", "编织");
        ROOTS.put("therm", "热");
        ROOTS.put("tim", "害怕");
        ROOTS.put("ton", "音调");
        ROOTS.put("tort", "扭曲");
        ROOTS.put("tour", "转动");
        ROOTS.put("tox", "毒");
        ROOTS.put("tract", "拉");
        ROOTS.put("trib", "给予");
        ROOTS.put("trud", "推");
        ROOTS.put("turb", "扰乱");
        ROOTS.put("umbr", "影子");
        ROOTS.put("urb", "城市");
        ROOTS.put("ut", "使用");
        ROOTS.put("vac", "空");
        ROOTS.put("vad", "行走");
        ROOTS.put("val", "价值");
        ROOTS.put("var", "变化");
        ROOTS.put("ven", "来到");
        ROOTS.put("ver", "真实");
        ROOTS.put("verb", "词语");
        ROOTS.put("vers", "转动");
        ROOTS.put("vert", "转动");
        ROOTS.put("vi", "道路");
        ROOTS.put("via", "道路");
        ROOTS.put("vid", "看见");
        ROOTS.put("vig", "活力");
        ROOTS.put("vinc", "征服");
        ROOTS.put("vir", "男人/病毒");
        ROOTS.put("vis", "看见");
        ROOTS.put("vit", "生命");
        ROOTS.put("viv", "活");
        ROOTS.put("voc", "声音/喊");
        ROOTS.put("vol", "意愿");
        ROOTS.put("volv", "旋转");
    }

    /**
     * 拆解单词词根词缀。无法可靠拆解时返回 null。
     * 输出示例：{@code "pre-(预先) + dict(说) + -ion(行为/结果)"}、{@code "un-(不) + believe + -able(可…的)"}。
     */
    @Nullable
    public static String analyze(String word) {
        String lower = word == null ? "" : word.trim().toLowerCase();
        if (lower.length() < 6 || !lower.matches("[a-z]+")) {
            return null;
        }

        String prefix = null;
        String prefixMeaning = null;
        String stem = lower;

        // 剥一个前缀：贪最长匹配，剥掉后主干至少 4 个字符；
        // 剩余恰好是词根表中的词根时放宽到 3（如 counteract → counter + act）
        for (Map.Entry<String, String> e : PREFIXES.entrySet()) {
            String p = e.getKey();
            int restLength = lower.length() - p.length();
            if (lower.startsWith(p)
                    && (restLength >= 4 || (restLength >= 3 && ROOTS.containsKey(lower.substring(p.length()))))) {
                prefix = p;
                prefixMeaning = e.getValue();
                stem = lower.substring(p.length());
                break;
            }
        }

        // 剥一个后缀：在主干上贪最长匹配，剥掉后主干至少 3 个字符
        String suffix = null;
        String suffixMeaning = null;
        for (Map.Entry<String, String> e : SUFFIXES.entrySet()) {
            String s = e.getKey();
            if (stem.endsWith(s) && stem.length() - s.length() >= 3) {
                suffix = s;
                suffixMeaning = e.getValue();
                stem = stem.substring(0, stem.length() - s.length());
                break;
            }
        }

        // 主干中找最长词根
        String rootKey = null;
        String rootMeaning = null;
        for (Map.Entry<String, String> e : ROOTS.entrySet()) {
            String r = e.getKey();
            if (r.length() >= 3 && stem.contains(r)
                    && (rootKey == null || r.length() > rootKey.length())) {
                rootKey = r;
                rootMeaning = e.getValue();
            }
        }

        // 还原 -tion/-sion 吃掉的词干字母：若 (主干+首字母) 以更长词根结尾，
        // 把该字母还给词干（prediction → dict + -ion 而不是 dic + -tion）
        String stemDisplay = stem;
        String suffixDisplay = suffix;
        if (suffix != null && (suffix.startsWith("t") || suffix.startsWith("s"))) {
            String extended = stem + suffix.charAt(0);
            for (Map.Entry<String, String> e : ROOTS.entrySet()) {
                String r = e.getKey();
                if (r.length() >= 3 && extended.endsWith(r)
                        && (rootKey == null || r.length() > rootKey.length())) {
                    rootKey = r;
                    rootMeaning = e.getValue();
                    stemDisplay = extended;
                    suffixDisplay = suffix.substring(1);
                }
            }
        }

        // 只标注词根、无前后缀可剥时，要求词根不能恰好等于整个词干开头太随意的短词
        if (prefix == null && suffix == null) {
            if (rootKey == null) {
                return null;
            }
            // 词根几乎等于原词（如 import 的 port），信息量太低的不输出
            if (rootKey.length() < lower.length() - 1) {
                return lower + " [" + rootKey + "=" + rootMeaning + "]";
            }
            return null;
        }

        List<String> parts = new ArrayList<>();
        if (prefix != null) {
            parts.add(prefix + "-(" + prefixMeaning + ")");
        }
        if (rootKey != null) {
            if (stemDisplay.equals(rootKey)) {
                parts.add(stemDisplay + "(" + rootMeaning + ")");
            } else {
                parts.add(stemDisplay + " [" + rootKey + "=" + rootMeaning + "]");
            }
        } else {
            parts.add(stemDisplay);
        }
        if (suffixDisplay != null) {
            parts.add("-" + suffixDisplay + "(" + suffixMeaning + ")");
        }
        return String.join(" + ", parts);
    }
}
