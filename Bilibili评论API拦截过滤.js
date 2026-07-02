// ==UserScript==
// @name         Bilibili 评论API拦截过滤
// @namespace    bilibili-comment-filter
// @version      1.0.0
// @description  Hook API response，过滤评论后再返回浏览器渲染
// @license      MIT
// @match        *://*.bilibili.com/*
// @exclude      *://api.bilibili.com/*
// @exclude      *://api.*.bilibili.com/*
// @exclude      *://*.bilibili.com/api/*
// @exclude      *://member.bilibili.com/studio/bs-editor/*
// @exclude      *://t.bilibili.com/h5/dynamic/specification
// @exclude      *://bbq.bilibili.com/*
// @exclude      *://message.bilibili.com/pages/nav/header_sync
// @exclude      *://s1.hdslb.com/bfs/seed/jinkela/short/cols/iframe.html
// @exclude      *://open-live.bilibili.com/*
// @exclude      *://*.bilibili.com/v/popular/*
// @grant        none
// @icon         https://www.bilibili.com/favicon.ico
// ==/UserScript==

(() => {
    'use strict';

    // DEBUG 开关
    const DEBUG = false;

    /******************************* 过滤内容匹配 ***************************************/

    // 模糊匹配  评论字符串
    let banCommentKeyMap = [
        
    ];

    // 屏蔽 指定 用户名 的评论（精准匹配）
    let banUserNameMap = [

    ];

    // 屏蔽 指定  用户名  的评论（模糊匹配）
    let banUserNameFuzzyMap = [

    ];

    // 屏蔽 指定 uid 的评论（精准匹配）
    let banUserUidMap = [

    ];

    // 屏蔽 banBelowLevel 级 以下的评论 ， 例如：3 ，则屏蔽 0、1、2 级下的评论
    const banBelowLevel = 3

    /*******************************下方内容不要修改***************************************/

    // 工具函数
    function createKeywordReg(list) {
        if (!Array.isArray(list) || list.length === 0) {
            return /$a/;
        }

        return new RegExp(list.filter(Boolean).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),'i');
    }

    const banRules = {
        comment: createKeywordReg(banCommentKeyMap),
        usernameFuzzy: createKeywordReg(banUserNameFuzzyMap),
        username: new Set(banUserNameMap),
        uid:new Set(banUserUidMap)
    };

    function matchKeyword(text, reg) {
        return !!text && reg.test(text);
    }

    function matchExact(value, set) {
        return !!value && set.has(String(value));
    }

    function isBanComment(text)
    {
        matchKeyword(text, banRules.comment);
    }

    function isBanUser(member)
    {
        if (!member) return false;

        // 屏蔽低于 banBelowLevel等级 的用户
        const level = member.level_info.current_level || 6;
        if (level < banBelowLevel) return true;

        // 屏蔽用户
        const name = member.uname || '';

        // 模糊匹配用户名
        if (matchKeyword(name,banRules.usernameFuzzy)) return true;

        // 精确匹配用户名
        if (matchExact(name,banRules.username)) return true;

        // 精确匹配UID
        const uid = member.mid || '';
        if (matchExact(uid,banRules.uid)) return true;

        return false;
    }

    /*************************************************
     *  DEBUG 打印
     *************************************************/
    const log = (...args) => DEBUG && console.log(
        '%c[BiliFilter]',
        'color:#00a1d6;font-weight:bold',
        ...args
    );

    const warn = (...args) => DEBUG && console.warn(
        '%c[BiliFilter]',
        'color:orange;font-weight:bold',
        ...args
    );

    /*************************************************
     *  评论数据过滤核心逻辑
     *************************************************/
    function filterReplyData(json, source = '') {
        try {
            const replies = json?.data?.replies;
            if (!Array.isArray(replies)) return json;

            const before = replies.length;

            json.data.replies = replies.filter(r => {
                if (!r) return false;

                // log(`[RAW JSON] [#1]`);
                // log(r);

                // 主评论过滤
                if (isBanUser(r.member)) {
                    log(r);
                    log('[BLOCK MAIN USER]', r.member?.uname);
                    return false;
                }

                if (isBanComment(r.content?.message)) {
                    log(r);
                    log('[BLOCK MAIN TEXT]', r.content?.message);
                    return false;
                }

                // 楼中楼过滤
                if (Array.isArray(r.replies)) {
                    r.replies = r.replies.filter(rr => {
                        if (isBanUser(rr.member)) return false;
                        if (isBanComment(rr.content?.message)) return false;
                        return true;
                    });
                }

                return true;
            });

            log(`[FILTER DONE] ${source}`, `before=${before}, after=${json.data.replies.length}`);

            return json;

        } catch (e) {
            warn('[FILTER ERROR]', e);
            return json;
        }
    }

    /*************************************************
     *  fetch hook（核心）
     *************************************************/
    const rawFetch = window.fetch;

    window.fetch = async function (...args) {

        const url = args[0]?.url || args[0];

        const res = await rawFetch(...args);

        try {
            if (typeof url === 'string' &&
                (
                url.includes('/x/v2/reply') ||
                url.includes('/x/v2/reply/wbi/main')
            )) {

                log('[FETCH HIT]', url);

                const clone = res.clone();
                const json = await clone.json();

                const filtered = filterReplyData(json, 'fetch');

                return new Response(JSON.stringify(filtered), {
                    status: res.status,
                    statusText: res.statusText,
                    headers: res.headers
                });
            }
        } catch (e) {
            warn('[FETCH HOOK ERROR]', e);
        }

        return res;
    };

    /*************************************************
     *  XHR hook（兼容旧请求）
     *************************************************/
    const open = XMLHttpRequest.prototype.open;
    const send = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
        this._url = url;
        return open.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function () {

        this.addEventListener('readystatechange', function () {

            if (this.readyState !== 4) return;

            try {
                if (this._url?.includes('/x/v2/reply')) {

                    log('[XHR HIT]', this._url);

                    const json = JSON.parse(this.responseText);

                    const filtered = filterReplyData(json, 'xhr');

                    Object.defineProperty(this, 'responseText', {
                        value: JSON.stringify(filtered)
                    });
                }
            } catch (e) {
                warn('[XHR HOOK ERROR]', e);
            }
        });

        return send.apply(this, arguments);
    };

    /*************************************************
     *  启动提示
     *************************************************/
    // log('initialized');
})();
