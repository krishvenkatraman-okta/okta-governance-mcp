resource "okta_app_group_assignment" "seeded" {
  for_each = local.group_app_assignments

  app_id   = okta_app_oauth.seeded[each.value.app].id
  group_id = okta_group.seeded[each.value.group].id
  priority = index(keys(local.group_app_assignments), each.key)
}

resource "okta_app_user" "seeded_direct" {
  for_each = local.direct_app_assignments

  app_id   = okta_app_oauth.seeded[each.value.app].id
  user_id  = okta_user.seeded[each.value.user].id
  username = okta_user.seeded[each.value.user].login
}
