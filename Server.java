import com.sun.net.httpserver.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/**
 * BACKEND - REST API + static file server. Java 17+, no libraries.
 * Run from the project root:  java backend/Server.java
 * Open: http://localhost:8080
 *
 * API
 *   GET    /api/jobs
 *   POST   /api/jobs                 {title, company, city, type, lpa, skills}
 *   DELETE /api/jobs/{id}
 *   GET    /api/applications         ?jobId=  &email=
 *   POST   /api/applications         {jobId, name, email, exp, note}
 *   PUT    /api/applications/{id}    {stage}
 */
public class Server {
    static final List<String> STAGES = List.of("Applied", "Screening", "Interview", "Offer", "Hired", "Rejected");
    static final Set<String> NUMERIC = Set.of("id", "jobId", "exp");
    static final List<Map<String, String>> jobs = new ArrayList<>(), apps = new ArrayList<>();
    static final Path DATA = Paths.get("backend", "data.txt"), FRONT = Paths.get("frontend");
    static final String[] JOB_KEYS = {"id", "title", "company", "city", "type", "lpa", "skills"};
    static final String[] APP_KEYS = {"id", "jobId", "name", "email", "exp", "note", "stage"};

    public static void main(String[] args) throws Exception {
        int port = args.length > 0 ? Integer.parseInt(args[0]) : 8080;
        load();
        HttpServer s = HttpServer.create(new InetSocketAddress(port), 0);
        s.createContext("/", Server::handle);
        s.start();
        System.out.println("Job and Recruitment System running at http://localhost:" + port);
    }

    // ---------- routing ----------
    static synchronized void handle(HttpExchange ex) throws IOException {
        try {
            String path = ex.getRequestURI().getPath();
            if (path.startsWith("/api/")) api(ex, path, ex.getRequestMethod(), query(ex.getRequestURI().getRawQuery()));
            else file(ex, path);
        } catch (Exception e) {
            e.printStackTrace();
            send(ex, 500, "{\"error\":\"Something went wrong on the server\"}", "application/json");
        }
    }

    static void api(HttpExchange ex, String path, String m, Map<String, String> q) throws IOException {
        ex.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
        ex.getResponseHeaders().set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
        ex.getResponseHeaders().set("Access-Control-Allow-Headers", "Content-Type");
        if (m.equals("OPTIONS")) {
            ex.sendResponseHeaders(204, -1);
            ex.close();
            return;
        }
        String[] p = path.substring(5).split("/");
        String res = p[0], id = p.length > 1 ? p[1] : null;
        if (res.equals("jobs") && id == null) {
            if (m.equals("GET")) { json(ex, 200, list(jobs, JOB_KEYS, null)); return; }
            if (m.equals("POST")) {
                Map<String, String> b = parse(body(ex));
                if (blank(b, "title") || blank(b, "company")) { err(ex, 400, "Enter a job title and company"); return; }
                Map<String, String> j = new LinkedHashMap<>();
                j.put("id", "" + nextId(jobs));
                j.put("title", c(b, "title", ""));   j.put("company", c(b, "company", ""));
                j.put("city", c(b, "city", "Remote")); j.put("type", c(b, "type", "Full-time"));
                j.put("lpa", c(b, "lpa", "Not disclosed")); j.put("skills", c(b, "skills", "General"));
                jobs.add(j); save(); json(ex, 201, one(j, JOB_KEYS)); return;
            }
        }
        if (res.equals("jobs") && id != null && m.equals("DELETE")) {
            boolean gone = jobs.removeIf(j -> j.get("id").equals(id));
            if (!gone) { err(ex, 404, "No job with that id"); return; }
            apps.removeIf(a -> a.get("jobId").equals(id)); save();
            json(ex, 200, "{\"ok\":true}"); return;
        }
        if (res.equals("applications") && id == null) {
            if (m.equals("GET")) {
                json(ex, 200, list(apps, APP_KEYS, a ->
                    (!q.containsKey("jobId") || a.get("jobId").equals(q.get("jobId"))) &&
                    (!q.containsKey("email") || a.get("email").equalsIgnoreCase(q.get("email"))))); return;
            }
            if (m.equals("POST")) {
                Map<String, String> b = parse(body(ex));
                String jid = c(b, "jobId", "");
                if (jobs.stream().noneMatch(j -> j.get("id").equals(jid))) { err(ex, 404, "That job no longer exists"); return; }
                if (blank(b, "name") || !c(b, "email", "").contains("@")) { err(ex, 400, "Enter your name and a valid email"); return; }
                String email = c(b, "email", "");
                if (apps.stream().anyMatch(a -> a.get("jobId").equals(jid) && a.get("email").equalsIgnoreCase(email))) {
                    err(ex, 409, "You have already applied to this job"); return;
                }
                Map<String, String> a = new LinkedHashMap<>();
                a.put("id", "" + nextId(apps)); a.put("jobId", jid); a.put("name", c(b, "name", "")); a.put("email", email);
                a.put("exp", "" + toInt(c(b, "exp", "0"))); a.put("note", c(b, "note", "")); a.put("stage", "Applied");
                apps.add(a); save(); json(ex, 201, one(a, APP_KEYS)); return;
            }
        }
        if (res.equals("applications") && id != null && m.equals("PUT")) {
            Map<String, String> b = parse(body(ex));
            String stage = c(b, "stage", "");
            if (!STAGES.contains(stage)) { err(ex, 400, "Unknown stage"); return; }
            for (Map<String, String> a : apps) if (a.get("id").equals(id)) {
                a.put("stage", stage); save(); json(ex, 200, one(a, APP_KEYS)); return;
            }
            err(ex, 404, "No application with that id"); return;
        }
        err(ex, 404, "Unknown API route");
    }

    // ---------- static frontend ----------
    static void file(HttpExchange ex, String path) throws IOException {
        Path f = FRONT.resolve(path.equals("/") ? "index.html" : path.substring(1)).normalize();
        if (!f.startsWith(FRONT) || !Files.isRegularFile(f)) { send(ex, 404, "Not found", "text/plain"); return; }
        String n = f.toString();
        String type = n.endsWith(".html") ? "text/html; charset=utf-8" : n.endsWith(".css") ? "text/css; charset=utf-8"
                    : n.endsWith(".js") ? "text/javascript; charset=utf-8" : "application/octet-stream";
        byte[] data = Files.readAllBytes(f);
        ex.getResponseHeaders().set("Content-Type", type);
        ex.sendResponseHeaders(200, data.length);
        try (OutputStream o = ex.getResponseBody()) { o.write(data); }
    }

    // ---------- helpers ----------
    interface Filter { boolean ok(Map<String, String> m); }
    static String list(List<Map<String, String>> src, String[] keys, Filter f) {
        StringJoiner sj = new StringJoiner(",", "[", "]");
        for (Map<String, String> m : src) if (f == null || f.ok(m)) sj.add(one(m, keys));
        return sj.toString();
    }
    static String one(Map<String, String> m, String[] keys) {
        StringJoiner sj = new StringJoiner(",", "{", "}");
        for (String k : keys) {
            String v = m.getOrDefault(k, "");
            sj.add("\"" + k + "\":" + (NUMERIC.contains(k) ? ("" + toInt(v)) : "\"" + esc(v) + "\""));
        }
        return sj.toString();
    }
    static String esc(String s) {
        StringBuilder b = new StringBuilder();
        for (char ch : s.toCharArray()) {
            if (ch == '"' || ch == '\\') b.append('\\').append(ch);
            else if (ch < 32) b.append(' ');
            else b.append(ch);
        }
        return b.toString();
    }
    static int toInt(String s) { try { return Math.max(0, Integer.parseInt(s.trim())); } catch (Exception e) { return 0; } }
    static int nextId(List<Map<String, String>> l) { return l.stream().mapToInt(m -> toInt(m.get("id"))).max().orElse(0) + 1; }
    static boolean blank(Map<String, String> b, String k) { return c(b, k, "").isEmpty(); }
    static String c(Map<String, String> b, String k, String d) {
        String v = b.getOrDefault(k, "").replace('\t', ' ').replace('\n', ' ').replace('\r', ' ').trim();
        if (v.length() > 500) v = v.substring(0, 500);
        return v.isEmpty() ? d : v;
    }
    static String body(HttpExchange ex) throws IOException { return new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8); }
    static void err(HttpExchange ex, int code, String msg) throws IOException { json(ex, code, "{\"error\":\"" + esc(msg) + "\"}"); }
    static void json(HttpExchange ex, int code, String s) throws IOException { send(ex, code, s, "application/json; charset=utf-8"); }
    static void send(HttpExchange ex, int code, String s, String type) throws IOException {
        byte[] d = s.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().set("Content-Type", type);
        ex.sendResponseHeaders(code, d.length);
        try (OutputStream o = ex.getResponseBody()) { o.write(d); }
    }
    static Map<String, String> query(String raw) {
        Map<String, String> m = new HashMap<>();
        if (raw == null) return m;
        for (String kv : raw.split("&")) {
            String[] p = kv.split("=", 2);
            if (p.length == 2 && !p[1].isEmpty()) m.put(URLDecoder.decode(p[0], StandardCharsets.UTF_8), URLDecoder.decode(p[1], StandardCharsets.UTF_8));
        }
        return m;
    }

    // tiny parser for flat JSON objects like {"a":"x","b":3}
    static String src; static int pos;
    static String readStr() {
        StringBuilder b = new StringBuilder(); pos++;
        while (pos < src.length()) {
            char ch = src.charAt(pos++);
            if (ch == '"') break;
            if (ch == '\\' && pos < src.length()) {
                char d = src.charAt(pos++);
                if (d == 'u' && pos + 4 <= src.length()) { b.append((char) Integer.parseInt(src.substring(pos, pos + 4), 16)); pos += 4; }
                else b.append(d == 'n' || d == 't' || d == 'r' ? ' ' : d);
            } else b.append(ch);
        }
        return b.toString();
    }
    static Map<String, String> parse(String s) {
        src = s; pos = 0;
        Map<String, String> m = new LinkedHashMap<>();
        while (pos < s.length()) {
            if (s.charAt(pos) != '"') { pos++; continue; }
            String k = readStr();
            while (pos < s.length() && (s.charAt(pos) == ':' || s.charAt(pos) == ' ')) pos++;
            String v;
            if (pos < s.length() && s.charAt(pos) == '"') v = readStr();
            else { int st = pos; while (pos < s.length() && ",} \n\r".indexOf(s.charAt(pos)) < 0) pos++; v = s.substring(st, pos); }
            m.put(k, v);
        }
        return m;
    }

    // ---------- persistence ----------
    static void save() {
        List<String> lines = new ArrayList<>();
        for (Map<String, String> j : jobs) { List<String> r = new ArrayList<>(List.of("J")); for (String k : JOB_KEYS) r.add(j.get(k)); lines.add(String.join("\t", r)); }
        for (Map<String, String> a : apps) { List<String> r = new ArrayList<>(List.of("A")); for (String k : APP_KEYS) r.add(a.get(k)); lines.add(String.join("\t", r)); }
        try { Files.write(DATA, lines); } catch (IOException e) { System.out.println("Could not save data: " + e.getMessage()); }
    }
    static void load() {
        if (Files.exists(DATA)) {
            try {
                for (String line : Files.readAllLines(DATA)) {
                    String[] p = line.split("\t", -1);
                    String[] keys = p[0].equals("J") ? JOB_KEYS : APP_KEYS;
                    Map<String, String> m = new LinkedHashMap<>();
                    for (int i = 0; i < keys.length; i++) m.put(keys[i], p[i + 1]);
                    (p[0].equals("J") ? jobs : apps).add(m);
                }
                return;
            } catch (Exception e) { jobs.clear(); apps.clear(); }
        }
        addJob("Java Developer", "Kalpa Systems", "Pimpri-Chinchwad", "Full-time", "6-12", "Java, Spring Boot, SQL");
        addJob("Frontend Developer", "Nimbus Labs", "Pune", "Full-time", "8-14", "React, CSS, TypeScript");
        addJob("HR Recruiter", "TalentBridge", "Pune", "Full-time", "3.5-6", "Sourcing, Screening");
        Map<String, String> a = new LinkedHashMap<>();
        a.put("id", "1"); a.put("jobId", "1"); a.put("name", "Riya Kulkarni"); a.put("email", "riya@example.com");
        a.put("exp", "3"); a.put("note", "Built REST APIs for 3 years."); a.put("stage", "Applied");
        apps.add(a); save();
    }
    static void addJob(String t, String c, String city, String type, String lpa, String sk) {
        Map<String, String> j = new LinkedHashMap<>();
        j.put("id", "" + nextId(jobs)); j.put("title", t); j.put("company", c); j.put("city", city);
        j.put("type", type); j.put("lpa", lpa); j.put("skills", sk); jobs.add(j);
    }
}
