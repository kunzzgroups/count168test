<?php

/**

 * Member Win/Loss：仅切换「查看」账号（写入 member_winloss_view_account_id），

 * 不改变登录身份 $_SESSION['user_id']（避免全站看起来像突然换了登录账号）。

 * 路径: api/session/update_account_session_api.php

 */



// 此 API 需要写入 session（切换账户），不能让 session_check.php 提前关闭锁

define('SESSION_KEEP_OPEN', true);



require_once __DIR__ . '/../../includes/session_check.php';

require_once __DIR__ . '/../includes/member_linked_closure.php';

require_once __DIR__ . '/../../includes/group_company_access.php';

require_once __DIR__ . '/../../includes/group_scope_resolve.php';

require_once __DIR__ . '/../../includes/tenant_scope.php';



header('Content-Type: application/json');



function jsonResponse($success, $message, $data = null, $httpCode = null) {

    if ($httpCode !== null) {

        http_response_code($httpCode);

    }

    echo json_encode([

        'success' => (bool) $success,

        'message' => $message,

        'data' => $data

    ], JSON_UNESCAPED_UNICODE);

}



function hasAccountLinkTable(PDO $pdo) {

    try {

        $stmt = $pdo->query("SHOW TABLES LIKE 'account_link'");

        return $stmt->rowCount() > 0;

    } catch (PDOException $e) {

        return false;

    }

}



/**
 * Empty-group members (no company anchor): the login/switch flow resolves
 * $_SESSION['company_id'] to an arbitrary linked subsidiary, which does not
 * hold the account's real (scope_type='group') account_company/account_link
 * rows. Prefer group-ledger scope whenever this session logged in via a
 * group code, so lookups match the ledger the account actually lives on.
 *
 * @return array{mode: 'group'|'company', group_pk: int, company_id: int}
 */
function resolveMemberScopeContext(PDO $pdo): array
{
    if (function_exists('gc_is_group_login') && gc_is_group_login()) {
        $ident = function_exists('gc_session_login_identifier') ? gc_session_login_identifier() : null;
        $groupPk = $ident ? (int) gc_resolve_group_pk_by_code($pdo, $ident) : 0;
        if ($groupPk > 0) {
            return ['mode' => 'group', 'group_pk' => $groupPk, 'company_id' => 0];
        }
    }

    return ['mode' => 'company', 'group_pk' => 0, 'company_id' => (int) ($_SESSION['company_id'] ?? 0)];
}

function getAccountInScope(PDO $pdo, $account_id, array $ctx) {
    if (($ctx['mode'] ?? '') === 'group') {
        if (!in_array((int) $account_id, tenant_collect_group_account_ids($pdo, (int) $ctx['group_pk']), true)) {
            return null;
        }
        $stmt = $pdo->prepare("SELECT id, account_id, name, status FROM account WHERE id = ? AND status = 'active'");
        $stmt->execute([$account_id]);
        return $stmt->fetch(PDO::FETCH_ASSOC);
    }

    $stmt = $pdo->prepare("

        SELECT a.id, a.account_id, a.name, a.status

        FROM account a

        INNER JOIN account_company ac ON a.id = ac.account_id

        WHERE a.id = ? AND ac.company_id = ? AND a.status = 'active'

    ");

    $stmt->execute([$account_id, (int) $ctx['company_id']]);

    return $stmt->fetch(PDO::FETCH_ASSOC);

}



function getLinkedAccountIdsInScope(PDO $pdo, $start_account_id, array $ctx) {

    $isGroup = ($ctx['mode'] ?? '') === 'group' && tenant_table_has_scope_columns($pdo, 'account_link');
    $bind = $isGroup ? [(string) 'group', (int) $ctx['group_pk']] : [(int) $ctx['company_id']];
    $scopeSql = $isGroup ? 'scope_type = ? AND scope_id = ?' : 'company_id = ?';

    $linked = [];

    $visited = [];

    $queue = [$start_account_id];

    while (!empty($queue)) {

        $current_id = array_shift($queue);

        if (isset($visited[$current_id])) continue;

        $visited[$current_id] = true;

        $linked[] = $current_id;

        $stmt = $pdo->prepare("

            SELECT account_id_2 AS linked_id FROM account_link WHERE account_id_1 = ? AND {$scopeSql}

            UNION

            SELECT account_id_1 AS linked_id FROM account_link WHERE account_id_2 = ? AND {$scopeSql}

        ");

        $stmt->execute(array_merge([$current_id], $bind, [$current_id], $bind));

        foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $linked_id) {

            if (!isset($visited[$linked_id])) $queue[] = $linked_id;

        }

    }

    return $linked;

}



try {

    if (!isset($_SESSION['user_id'])) {

        jsonResponse(false, '用户未登录', null, 401);

        exit;

    }

    $current_user_type = strtolower($_SESSION['user_type'] ?? '');

    if ($current_user_type !== 'member') {

        jsonResponse(false, '只有 member 用户可以使用此功能', null, 403);

        exit;

    }



    $requested_account_id = null;

    if (isset($_GET['account_id']) && $_GET['account_id'] !== '') {

        $requested_account_id = (int) $_GET['account_id'];

    } elseif (isset($_POST['account_id']) && $_POST['account_id'] !== '') {

        $requested_account_id = (int) $_POST['account_id'];

    }

    if (!$requested_account_id) {

        jsonResponse(false, '缺少 account_id 参数', null, 400);

        exit;

    }



    $login_account_id = member_session_canonical_account_id();

    if ($login_account_id <= 0) {

        jsonResponse(false, '无法识别登录账号', null, 403);

        exit;

    }



    if (empty($_SESSION['member_login_account_id'])) {

        $_SESSION['member_login_account_id'] = $login_account_id;

    }



    $scopeCtx = resolveMemberScopeContext($pdo);

    if ($scopeCtx['mode'] !== 'group' && !$scopeCtx['company_id']) {

        jsonResponse(false, '缺少公司信息', null, 400);

        exit;

    }



    if (!hasAccountLinkTable($pdo)) {

        jsonResponse(false, '账户关联功能未启用', null, 500);

        exit;

    }



    $login_row = getAccountInScope($pdo, $login_account_id, $scopeCtx);

    if (!$login_row) {

        jsonResponse(false, '登录账号不存在、不属于当前公司或已停用', null, 403);

        exit;

    }



    // 恒定登录身份（与会话一致性）

    $_SESSION['user_id'] = $login_account_id;

    $_SESSION['login_id'] = $login_row['account_id'];

    $_SESSION['name'] = $login_row['name'];

    $_SESSION['account_id'] = $login_row['account_id'];



    $target_account = getAccountInScope($pdo, $requested_account_id, $scopeCtx);

    if (!$target_account) {

        jsonResponse(false, '账户不存在、不属于当前公司或已停用', null, 403);

        exit;

    }



    $view_now_id = member_session_winloss_view_account_id();

    if ($requested_account_id === $view_now_id) {

        session_write_close();

        jsonResponse(true, '已经是当前账户', [

            'account_id'   => $view_now_id,

            'account_code' => ($view_now_id === $login_account_id)

                ? $login_row['account_id']

                : $target_account['account_id'],

            'account_name' => ($view_now_id === $login_account_id)

                ? $login_row['name']

                : $target_account['name'],

        ]);

        exit;

    }



    $linked_account_ids = getLinkedAccountIdsInScope($pdo, $login_account_id, $scopeCtx);

    if (!in_array($requested_account_id, $linked_account_ids)) {

        jsonResponse(false, '该账户与当前账户未关联，无法切换', null, 403);

        exit;

    }



    if ($requested_account_id === $login_account_id) {

        unset($_SESSION['member_winloss_view_account_id']);

    } else {

        $_SESSION['member_winloss_view_account_id'] = $requested_account_id;

    }



    $view_after_id = member_session_winloss_view_account_id();

    $view_row = ($view_after_id === $login_account_id)

        ? $login_row

        : getAccountInScope($pdo, $view_after_id, $scopeCtx);

    $view_code = $view_row ? (string) ($view_row['account_id'] ?? '') : '';

    $view_name = $view_row ? (string) ($view_row['name'] ?? '') : '';



    session_write_close();



    jsonResponse(true, '账户已切换', [

        'account_id'   => $view_after_id,

        'account_code' => $view_code,

        'account_name' => $view_name,

    ]);

} catch (Exception $e) {

    session_write_close();

    jsonResponse(false, $e->getMessage(), null, 500);

}

