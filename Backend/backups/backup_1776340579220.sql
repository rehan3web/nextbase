--
-- PostgreSQL database dump
--

\restrict qga0smzB1QkzfpDgFwiXUiv1AdIZQad9ObwBZheLHiTX3AEuHR4enql95xc7UHK

-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: cv_copy_1776339930292; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.cv_copy_1776339930292 (
    id bigint,
    created_at timestamp with time zone
);


ALTER TABLE public.cv_copy_1776339930292 OWNER TO postgres;

--
-- Name: f; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.f (
    id bigint,
    created_at timestamp with time zone
);


ALTER TABLE public.f OWNER TO postgres;

--
-- Name: sda; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sda (
    id bigint,
    created_at timestamp with time zone
);


ALTER TABLE public.sda OWNER TO postgres;

--
-- Name: xc; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.xc (
    id bigint,
    created_at timestamp with time zone,
    cxxc text,
    "`" text,
    vcv text
);


ALTER TABLE public.xc OWNER TO postgres;

--
-- Data for Name: cv_copy_1776339930292; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.cv_copy_1776339930292 (id, created_at) FROM stdin;
\.


--
-- Data for Name: f; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.f (id, created_at) FROM stdin;
\.


--
-- Data for Name: sda; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.sda (id, created_at) FROM stdin;
\.


--
-- Data for Name: xc; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.xc (id, created_at, cxxc, "`", vcv) FROM stdin;
\N	\N	xcx	\N	\N
\N	\N	xcc	\N	\N
\.


--
-- PostgreSQL database dump complete
--

\unrestrict qga0smzB1QkzfpDgFwiXUiv1AdIZQad9ObwBZheLHiTX3AEuHR4enql95xc7UHK

