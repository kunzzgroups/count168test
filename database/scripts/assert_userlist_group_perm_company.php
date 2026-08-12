<?php
/**
 * Feedback loop: group_only get must prefer entity company over session subsidiary.
 * Run: php database/scripts/assert_userlist_group_perm_company.php
 */
declare(strict_types=1);

function assert_userlist_resolve_get_perm_company_id(
    int $sessionCompanyId,
    ?string $groupScope,
    bool $groupOnly,
    int $entityCompanyId
): int {
    $permCompanyId = $sessionCompanyId;
    if ($groupScope !== null && $groupScope !== '' && $groupOnly) {
        if ($entityCompanyId > 0) {
            return $entityCompanyId;
        }
        return $permCompanyId;
    }
    if ($permCompanyId <= 0 && $groupScope !== null && $groupScope !== '') {
        return $entityCompanyId > 0 ? $entityCompanyId : 0;
    }
    return $permCompanyId;
}

$cases = [
    // Bug: session subsidiary 123, group AP entity 5 → must return 5 for group_only get
    ['session' => 123, 'group' => 'AP', 'groupOnly' => true, 'entity' => 5, 'want' => 5],
    // Company edit (not group_only): keep session company
    ['session' => 123, 'group' => 'AP', 'groupOnly' => false, 'entity' => 5, 'want' => 123],
    // Pure group login: no session company
    ['session' => 0, 'group' => 'AP', 'groupOnly' => true, 'entity' => 5, 'want' => 5],
    ['session' => 0, 'group' => 'AP', 'groupOnly' => false, 'entity' => 5, 'want' => 5],
];

$failed = 0;
foreach ($cases as $i => $c) {
    $got = assert_userlist_resolve_get_perm_company_id(
        $c['session'],
        $c['group'],
        $c['groupOnly'],
        $c['entity']
    );
    if ($got !== $c['want']) {
        fwrite(STDERR, "FAIL case {$i}: got {$got}, want {$c['want']}\n");
        $failed++;
    }
}

if ($failed > 0) {
    fwrite(STDERR, "{$failed} case(s) failed\n");
    exit(1);
}
fwrite(STDOUT, "OK " . count($cases) . " cases\n");
exit(0);
