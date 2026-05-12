locals {
  prefix = "hack-govmcp"

  departments = {
    engineering = { title_ic = "Software Engineer", title_mgr = "Engineering Manager" }
    sales       = { title_ic = "Account Executive",  title_mgr = "Sales Manager" }
    finance     = { title_ic = "Financial Analyst",  title_mgr = "Finance Manager" }
  }

  # Flat user definitions. `manager_key` references another entry in this map
  # by its key — resolved at assignment time after all users exist.
  users = {
    eng_mgr      = { dept = "engineering", role = "mgr", manager_key = null }
    eng_user_1   = { dept = "engineering", role = "ic",  manager_key = "eng_mgr" }
    eng_user_2   = { dept = "engineering", role = "ic",  manager_key = "eng_mgr" }
    eng_user_3   = { dept = "engineering", role = "ic",  manager_key = "eng_mgr" }
    eng_user_4   = { dept = "engineering", role = "ic",  manager_key = "eng_mgr" }
    eng_user_5   = { dept = "engineering", role = "ic",  manager_key = "eng_mgr" }
    eng_user_6   = { dept = "engineering", role = "ic",  manager_key = "eng_mgr" }

    sales_mgr    = { dept = "sales", role = "mgr", manager_key = null }
    sales_user_1 = { dept = "sales", role = "ic",  manager_key = "sales_mgr" }
    sales_user_2 = { dept = "sales", role = "ic",  manager_key = "sales_mgr" }
    sales_user_3 = { dept = "sales", role = "ic",  manager_key = "sales_mgr" }
    sales_user_4 = { dept = "sales", role = "ic",  manager_key = "sales_mgr" }
    sales_user_5 = { dept = "sales", role = "ic",  manager_key = "sales_mgr" }
    sales_user_6 = { dept = "sales", role = "ic",  manager_key = "sales_mgr" }

    fin_mgr      = { dept = "finance", role = "mgr", manager_key = null }
    fin_user_1   = { dept = "finance", role = "ic",  manager_key = "fin_mgr" }
    fin_user_2   = { dept = "finance", role = "ic",  manager_key = "fin_mgr" }
    fin_user_3   = { dept = "finance", role = "ic",  manager_key = "fin_mgr" }
    fin_user_4   = { dept = "finance", role = "ic",  manager_key = "fin_mgr" }
    fin_user_5   = { dept = "finance", role = "ic",  manager_key = "fin_mgr" }
    fin_user_6   = { dept = "finance", role = "ic",  manager_key = "fin_mgr" }
  }

  groups = {
    engineering    = { description = "Engineering department" }
    sales          = { description = "Sales department" }
    finance        = { description = "Finance department" }
    all_employees  = { description = "All employees (cross-functional)" }
    vpn_users      = { description = "VPN-eligible users (cross-functional subset)" }
    admin          = { description = "Privileged admin users" }
  }

  # Department → list of user keys assigned to that department's group.
  group_members = {
    engineering   = [for k, v in local.users : k if v.dept == "engineering"]
    sales         = [for k, v in local.users : k if v.dept == "sales"]
    finance       = [for k, v in local.users : k if v.dept == "finance"]
    all_employees = keys(local.users)
    vpn_users     = ["eng_mgr", "eng_user_1", "eng_user_2", "sales_mgr", "fin_mgr"]
    # admin: managers + one deliberate outlier (sales_user_1 has admin = peer-group anomaly)
    admin = ["eng_mgr", "sales_mgr", "fin_mgr", "sales_user_1"]
  }

  # Three apps with department-keyed assignment patterns. The variance is
  # intentional: it's what gives mineRoles distinct clusters and gives
  # detectOutliers a baseline to compare against.
  apps = {
    acme     = { label = "acme-app",     description = "Baseline app — everyone has it" }
    payroll  = { label = "payroll-app",  description = "Finance-only app" }
    devtools = { label = "devtools-app", description = "Engineering-only app" }
  }

  # Group → list of app keys it grants. Drives the bulk of access patterns.
  # Composite keys "<group>:<app>" because each pair becomes one resource.
  group_app_assignments = {
    "all_employees:acme"   = { group = "all_employees", app = "acme" }
    "engineering:devtools" = { group = "engineering",   app = "devtools" }
    "finance:payroll"      = { group = "finance",       app = "payroll" }
    "admin:acme"           = { group = "admin",         app = "acme" }
    "admin:payroll"        = { group = "admin",         app = "payroll" }
    "admin:devtools"       = { group = "admin",         app = "devtools" }
  }

  # Direct user→app assignments — each one breaks its user's peer pattern,
  # creating outliers for detectOutliers and items for the smart-campaign
  # `directAssignments` rule.
  direct_app_assignments = {
    "eng_user_1:payroll"    = { user = "eng_user_1",   app = "payroll" }   # eng w/ finance app
    "fin_user_1:devtools"   = { user = "fin_user_1",   app = "devtools" }  # finance w/ eng app
    "sales_user_2:devtools" = { user = "sales_user_2", app = "devtools" }  # sales w/ eng app
  }

  entitlements = {
    role = {
      name           = "Role"
      external_value = "role"
      description    = "Application role granted to the principal"
      multi_value    = false
      values = {
        viewer = { name = "Viewer",  description = "Read-only access" }
        editor = { name = "Editor",  description = "Read + write access" }
        admin  = { name = "Admin",   description = "Full administrative access" }
      }
    }
    region = {
      name           = "Region"
      external_value = "region"
      description    = "Geographic region the principal can operate in"
      multi_value    = true
      values = {
        us = { name = "US", description = "United States region" }
        eu = { name = "EU", description = "European Union region" }
      }
    }
  }

  bundles = {
    readonly = {
      name        = "Read-only access"
      description = "Viewer role, US region"
      contents    = { role = ["viewer"], region = ["us"] }
    }
    power = {
      name        = "Power user"
      description = "Editor role, US + EU"
      contents    = { role = ["editor"], region = ["us", "eu"] }
    }
    admin = {
      name        = "Administrator"
      description = "Admin role, US + EU"
      contents    = { role = ["admin"], region = ["us", "eu"] }
    }
  }
}
